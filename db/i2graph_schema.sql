/* i2Graph schema bootstrap for SQL Server (attach to i2graph.mdf or any DB)
   Safe to run multiple times: uses IF OBJECT_ID checks
*/
SET NOCOUNT ON;

/* Projects */
IF OBJECT_ID('dbo.Project','U') IS NULL
CREATE TABLE dbo.Project (
  ProjectId       INT IDENTITY(1,1) PRIMARY KEY,
  Name            NVARCHAR(200) NOT NULL,
  CreatedBy       INT NOT NULL,
  ModifiedBy      INT NULL,
  CreatedAt       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  UpdatedAt       DATETIME2 NULL
);

/* Grouping state (single active per project; overwrite on save) */
IF OBJECT_ID('dbo.Grouping','U') IS NULL
CREATE TABLE dbo.Grouping (
  GroupingId      INT IDENTITY(1,1) PRIMARY KEY,
  ProjectId       INT NOT NULL REFERENCES dbo.Project(ProjectId),
  CreatedAt       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  UpdatedAt       DATETIME2 NULL,
  Status          NVARCHAR(20) NOT NULL DEFAULT 'active'
);
CREATE UNIQUE INDEX UX_Grouping_Project_Active ON dbo.Grouping(ProjectId, Status) WHERE Status='active';

/* Individual groups (columns mapped to ID/EN/AR) */
IF OBJECT_ID('dbo.[Group]','U') IS NULL
CREATE TABLE dbo.[Group] (
  GroupId         INT IDENTITY(1,1) PRIMARY KEY,
  GroupingId      INT NOT NULL REFERENCES dbo.Grouping(GroupingId) ON DELETE CASCADE,
  OrderIndex      INT NOT NULL,
  IdCol           NVARCHAR(128) NULL,
  EnCol           NVARCHAR(128) NOT NULL,
  ArCol           NVARCHAR(128) NOT NULL,
  IdStrategy      NVARCHAR(20)  NOT NULL CHECK (IdStrategy IN ('hash','column'))
);
CREATE INDEX IX_Group_Grouping_Order ON dbo.[Group](GroupingId, OrderIndex);

/* Group display names (bilingual) */
IF OBJECT_ID('dbo.GroupName','U') IS NULL
CREATE TABLE dbo.GroupName (
  GroupNameId     INT IDENTITY(1,1) PRIMARY KEY,
  GroupId         INT NOT NULL REFERENCES dbo.[Group](GroupId) ON DELETE CASCADE,
  NameEn          NVARCHAR(200) NOT NULL,
  NameAr          NVARCHAR(200) NULL,
  CreatedAt       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE UNIQUE INDEX UX_GroupName_Group ON dbo.GroupName(GroupId);

/* Node definitions (which groups are nodes) */
IF OBJECT_ID('dbo.NodeDef','U') IS NULL
CREATE TABLE dbo.NodeDef (
  NodeId          INT IDENTITY(1,1) PRIMARY KEY,
  ProjectId       INT NOT NULL REFERENCES dbo.Project(ProjectId),
  GroupId         INT NOT NULL REFERENCES dbo.[Group](GroupId) ON DELETE CASCADE,
  NodeIndex       INT NOT NULL, -- aligns with Group.OrderIndex for ease of mapping
  IsNode          BIT NOT NULL,
  LabelKey        NVARCHAR(128) NULL, -- Neo4j-safe label (PascalCase)
  LabelEn         NVARCHAR(200) NULL,
  LabelAr         NVARCHAR(200) NULL,
  CreatedAt       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_NodeDef_Project ON dbo.NodeDef(ProjectId);
CREATE UNIQUE INDEX UX_NodeDef_ProjectIndex ON dbo.NodeDef(ProjectId, NodeIndex);

/* Relationship definitions between nodes */
IF OBJECT_ID('dbo.RelationshipDef','U') IS NULL
CREATE TABLE dbo.RelationshipDef (
  RelId           INT IDENTITY(1,1) PRIMARY KEY,
  ProjectId       INT NOT NULL REFERENCES dbo.Project(ProjectId),
  FromNodeId      INT NOT NULL REFERENCES dbo.NodeDef(NodeId) ON DELETE CASCADE,
  ToNodeId        INT NOT NULL REFERENCES dbo.NodeDef(NodeId) ON DELETE CASCADE,
  TypeKey         NVARCHAR(128) NULL, -- Neo4j-safe type (UPPER_SNAKE)
  NameEn          NVARCHAR(200) NULL,
  NameAr          NVARCHAR(200) NULL,
  Direction       NVARCHAR(8)   NOT NULL CHECK (Direction IN ('out','in','both')),
  Include         BIT NOT NULL DEFAULT 1,
  CreatedAt       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_Rel_Project ON dbo.RelationshipDef(ProjectId);

/* No versioning/snapshots needed for this app */

/*
  Stored procedures (JSON inputs; requires SQL Server 2016+ for OPENJSON)
*/

IF OBJECT_ID('dbo.usp_CreateProject','P') IS NOT NULL DROP PROCEDURE dbo.usp_CreateProject;
GO
CREATE PROCEDURE dbo.usp_CreateProject
  @Name NVARCHAR(200),
  @CreatedBy INT
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.Project(Name, CreatedBy) VALUES(@Name, @CreatedBy);
  SELECT SCOPE_IDENTITY() AS ProjectId;
END
GO

/* Single-shot save: overwrite grouping, names, nodes, relationships in one transaction */
IF OBJECT_ID('dbo.usp_SaveGraphDefinition','P') IS NOT NULL DROP PROCEDURE dbo.usp_SaveGraphDefinition;
GO
CREATE PROCEDURE dbo.usp_SaveGraphDefinition
  @ProjectId INT,
  @Payload NVARCHAR(MAX), -- { grouping:{groups:[{index,idCol,enCol,arCol,idStrategy,nameEn?,nameAr?}]}, nodes:[...], relationships:[...] }
  @UserId INT = NULL
AS
BEGIN
  SET NOCOUNT ON;
  BEGIN TRY
    BEGIN TRAN;

      DECLARE @GroupingId INT;
      SELECT TOP 1 @GroupingId = GroupingId FROM dbo.Grouping WHERE ProjectId=@ProjectId AND Status='active' ORDER BY GroupingId DESC;
      IF @GroupingId IS NULL
      BEGIN
        INSERT INTO dbo.Grouping(ProjectId) VALUES(@ProjectId);
        SET @GroupingId = SCOPE_IDENTITY();
      END
      ELSE
      BEGIN
        UPDATE dbo.Grouping SET UpdatedAt=SYSUTCDATETIME() WHERE GroupingId=@GroupingId;
      END

      /* Mark project modified */
      IF @UserId IS NOT NULL
        UPDATE dbo.Project SET ModifiedBy=@UserId, UpdatedAt=SYSUTCDATETIME() WHERE ProjectId=@ProjectId;

      /* Groups: overwrite */
      ;WITH gjson AS (
        SELECT TRY_CAST(JSON_VALUE(value,'$.index') AS INT) AS OrderIndex,
               NULLIF(JSON_VALUE(value,'$.idCol'),'') AS IdCol,
               NULLIF(JSON_VALUE(value,'$.enCol'),'') AS EnCol,
               NULLIF(JSON_VALUE(value,'$.arCol'),'') AS ArCol,
               CASE WHEN JSON_VALUE(value,'$.idStrategy') IN ('hash','column') THEN JSON_VALUE(value,'$.idStrategy') ELSE 'hash' END AS IdStrategy,
               NULLIF(JSON_VALUE(value,'$.nameEn'),'') AS NameEn,
               NULLIF(JSON_VALUE(value,'$.nameAr'),'') AS NameAr
        FROM OPENJSON(@Payload, '$.grouping.groups')
      )
      BEGIN
        DELETE FROM dbo.[Group] WHERE GroupingId=@GroupingId;
        INSERT INTO dbo.[Group](GroupingId, OrderIndex, IdCol, EnCol, ArCol, IdStrategy)
        SELECT @GroupingId, OrderIndex, IdCol, EnCol, ArCol, IdStrategy FROM gjson;
        INSERT INTO dbo.GroupName(GroupId, NameEn, NameAr)
        SELECT g.GroupId, j.NameEn, j.NameAr
        FROM gjson j
        JOIN dbo.[Group] g ON g.GroupingId=@GroupingId AND g.OrderIndex=j.OrderIndex
        WHERE (j.NameEn IS NOT NULL OR j.NameAr IS NOT NULL);
      END

      /* Nodes: upsert and delete orphans */
      ;WITH njson AS (
        SELECT TRY_CAST(JSON_VALUE(value,'$.index') AS INT) AS NodeIndex,
               TRY_CAST(JSON_VALUE(value,'$.isNode') AS BIT) AS IsNode,
               NULLIF(JSON_VALUE(value,'$.labelKey'),'') AS LabelKey,
               NULLIF(JSON_VALUE(value,'$.en'),'') AS LabelEn,
               NULLIF(JSON_VALUE(value,'$.ar'),'') AS LabelAr
        FROM OPENJSON(@Payload, '$.nodes')
      )
      MERGE dbo.NodeDef AS t
      USING (
        SELECT @ProjectId AS ProjectId, g.GroupId, g.OrderIndex AS NodeIndex, n.IsNode, n.LabelKey, n.LabelEn, n.LabelAr
        FROM njson n
        JOIN dbo.[Group] g ON g.GroupingId=@GroupingId AND g.OrderIndex=n.NodeIndex
      ) AS s
      ON t.ProjectId=s.ProjectId AND t.NodeIndex=s.NodeIndex
      WHEN MATCHED THEN UPDATE SET t.IsNode=s.IsNode, t.GroupId=s.GroupId, t.LabelKey=s.LabelKey, t.LabelEn=s.LabelEn, t.LabelAr=s.LabelAr
      WHEN NOT MATCHED THEN INSERT(ProjectId, GroupId, NodeIndex, IsNode, LabelKey, LabelEn, LabelAr)
                           VALUES(s.ProjectId, s.GroupId, s.NodeIndex, s.IsNode, s.LabelKey, s.LabelEn, s.LabelAr)
      WHEN NOT MATCHED BY SOURCE AND t.ProjectId=@ProjectId THEN DELETE;

      /* Relationships: upsert included ones and delete others */
      ;WITH rjson AS (
        SELECT TRY_CAST(JSON_VALUE(value,'$.from') AS INT) AS FromIndex,
               TRY_CAST(JSON_VALUE(value,'$.to') AS INT)   AS ToIndex,
               TRY_CAST(JSON_VALUE(value,'$.include') AS BIT) AS IncludeFlg,
               NULLIF(JSON_VALUE(value,'$.typeKey'),'') AS TypeKey,
               NULLIF(JSON_VALUE(value,'$.en'),'') AS NameEn,
               NULLIF(JSON_VALUE(value,'$.ar'),'') AS NameAr,
               CASE WHEN JSON_VALUE(value,'$.dir') IN ('out','in','both') THEN JSON_VALUE(value,'$.dir') ELSE 'out' END AS Direction
        FROM OPENJSON(@Payload, '$.relationships')
      ),
      nn AS (
        SELECT NodeId, NodeIndex FROM dbo.NodeDef WHERE ProjectId=@ProjectId AND IsNode=1
      ), candidates AS (
        SELECT @ProjectId AS ProjectId,
               nf.NodeId AS FromNodeId,
               nt.NodeId AS ToNodeId,
               COALESCE(NULLIF(r.TypeKey,''), NULLIF(r.NameEn,'')) AS TypeKey,
               r.NameEn, r.NameAr,
               r.Direction AS Direction
        FROM rjson r
        JOIN nn nf ON nf.NodeIndex = r.FromIndex
        JOIN nn nt ON nt.NodeIndex = r.ToIndex
        WHERE nf.NodeId IS NOT NULL AND nt.NodeId IS NOT NULL AND nf.NodeId <> nt.NodeId AND ISNULL(r.IncludeFlg,0)=1
      )
      MERGE dbo.RelationshipDef AS t
      USING candidates AS s
      ON t.ProjectId=s.ProjectId AND t.FromNodeId=s.FromNodeId AND t.ToNodeId=s.ToNodeId
      WHEN MATCHED THEN UPDATE SET t.TypeKey=s.TypeKey, t.NameEn=s.NameEn, t.NameAr=s.NameAr, t.Direction=s.Direction, t.Include=1
      WHEN NOT MATCHED THEN INSERT(ProjectId, FromNodeId, ToNodeId, TypeKey, NameEn, NameAr, Direction, Include)
                           VALUES(s.ProjectId, s.FromNodeId, s.ToNodeId, s.TypeKey, s.NameEn, s.NameAr, s.Direction, 1)
      WHEN NOT MATCHED BY SOURCE AND t.ProjectId=@ProjectId THEN DELETE;

    COMMIT TRAN;
    SELECT GroupingId=@GroupingId;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT>0 ROLLBACK TRAN;
    THROW;
  END CATCH
END
GO

/* Delete helpers (hard delete, no audit/versioning) */
IF OBJECT_ID('dbo.usp_DeleteProject','P') IS NOT NULL DROP PROCEDURE dbo.usp_DeleteProject;
GO
CREATE PROCEDURE dbo.usp_DeleteProject
  @ProjectId INT
AS
BEGIN
  SET NOCOUNT ON;
  BEGIN TRY
    BEGIN TRAN;
      DELETE FROM dbo.RelationshipDef WHERE ProjectId=@ProjectId;
      DELETE FROM dbo.NodeDef WHERE ProjectId=@ProjectId;
      DELETE g
      FROM dbo.[Group] g
      JOIN dbo.Grouping grp ON grp.GroupingId=g.GroupingId AND grp.ProjectId=@ProjectId;
      DELETE FROM dbo.Grouping WHERE ProjectId=@ProjectId;
      DELETE FROM dbo.Project WHERE ProjectId=@ProjectId;
    COMMIT TRAN;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT>0 ROLLBACK TRAN;
    THROW;
  END CATCH
END
GO

IF OBJECT_ID('dbo.usp_DeleteGrouping','P') IS NOT NULL DROP PROCEDURE dbo.usp_DeleteGrouping;
GO
CREATE PROCEDURE dbo.usp_DeleteGrouping
  @GroupingId INT
AS
BEGIN
  SET NOCOUNT ON;
  BEGIN TRY
    BEGIN TRAN;
      DELETE FROM dbo.[Group] WHERE GroupingId=@GroupingId; -- cascades GroupName
      DELETE FROM dbo.Grouping WHERE GroupingId=@GroupingId;
    COMMIT TRAN;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT>0 ROLLBACK TRAN;
    THROW;
  END CATCH
END
GO

IF OBJECT_ID('dbo.usp_DeleteNode','P') IS NOT NULL DROP PROCEDURE dbo.usp_DeleteNode;
GO
CREATE PROCEDURE dbo.usp_DeleteNode
  @NodeId INT
AS
BEGIN
  SET NOCOUNT ON;
  -- RelationshipDef has ON DELETE CASCADE on NodeDef, so this removes connected rels too
  DELETE FROM dbo.NodeDef WHERE NodeId=@NodeId;
END
GO

IF OBJECT_ID('dbo.usp_DeleteRelationship','P') IS NOT NULL DROP PROCEDURE dbo.usp_DeleteRelationship;
GO
CREATE PROCEDURE dbo.usp_DeleteRelationship
  @RelId INT
AS
BEGIN
  SET NOCOUNT ON;
  DELETE FROM dbo.RelationshipDef WHERE RelId=@RelId;
END
GO

IF OBJECT_ID('dbo.usp_SaveGrouping','P') IS NOT NULL DROP PROCEDURE dbo.usp_SaveGrouping;
GO
CREATE PROCEDURE dbo.usp_SaveGrouping
  @ProjectId INT,
  @GroupsJson NVARCHAR(MAX) -- [{"id":"empid","en":"empnameen","ar":"empnamear","idStrategy":"column"}, ...]
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @GroupingId INT;
  SELECT TOP 1 @GroupingId = GroupingId FROM dbo.Grouping WHERE ProjectId=@ProjectId AND Status='active' ORDER BY GroupingId DESC;
  IF @GroupingId IS NULL
  BEGIN
    INSERT INTO dbo.Grouping(ProjectId) VALUES(@ProjectId);
    SET @GroupingId = SCOPE_IDENTITY();
  END
  ELSE
  BEGIN
    UPDATE dbo.Grouping SET UpdatedAt = SYSUTCDATETIME() WHERE GroupingId=@GroupingId;
    DELETE FROM dbo.[Group] WHERE GroupingId=@GroupingId; -- overwrite existing mapping
  END

  ;WITH j AS (
    SELECT ROW_NUMBER() OVER (ORDER BY (SELECT 1)) AS rn,
           JSON_VALUE(value,'$.id')  AS IdCol,
           JSON_VALUE(value,'$.en')  AS EnCol,
           JSON_VALUE(value,'$.ar')  AS ArCol,
           JSON_VALUE(value,'$.idStrategy') AS IdStrategy
    FROM OPENJSON(@GroupsJson)
  )
  INSERT INTO dbo.[Group](GroupingId, OrderIndex, IdCol, EnCol, ArCol, IdStrategy)
  SELECT @GroupingId, rn-1, NULLIF(IdCol,''), EnCol, ArCol, CASE WHEN IdStrategy IN ('hash','column') THEN IdStrategy ELSE 'hash' END
  FROM j;

  SELECT @GroupingId AS GroupingId,
         g.GroupId, g.OrderIndex, g.IdCol, g.EnCol, g.ArCol, g.IdStrategy
  FROM dbo.[Group] g WHERE g.GroupingId = @GroupingId ORDER BY g.OrderIndex;
END
GO

IF OBJECT_ID('dbo.usp_SaveGroupNames','P') IS NOT NULL DROP PROCEDURE dbo.usp_SaveGroupNames;
GO
CREATE PROCEDURE dbo.usp_SaveGroupNames
  @GroupingId INT,
  @NamesJson NVARCHAR(MAX) -- [{"index":0,"en":"Employee","ar":"موظف"}, ...]
AS
BEGIN
  SET NOCOUNT ON;
  ;WITH j AS (
    SELECT TRY_CAST(JSON_VALUE(value,'$.index') AS INT) AS OrderIndex,
           JSON_VALUE(value,'$.en') AS NameEn,
           JSON_VALUE(value,'$.ar') AS NameAr
    FROM OPENJSON(@NamesJson)
  )
  MERGE dbo.GroupName AS t
  USING (
    SELECT g.GroupId, j.NameEn, j.NameAr
    FROM j
    JOIN dbo.[Group] g ON g.GroupingId=@GroupingId AND g.OrderIndex=j.OrderIndex
  ) AS s
  ON t.GroupId = s.GroupId
  WHEN MATCHED THEN UPDATE SET t.NameEn = s.NameEn, t.NameAr = s.NameAr
  WHEN NOT MATCHED THEN INSERT(GroupId, NameEn, NameAr) VALUES(s.GroupId, s.NameEn, s.NameAr);

  SELECT g.GroupId, g.OrderIndex, n.NameEn, n.NameAr
  FROM dbo.[Group] g
  LEFT JOIN dbo.GroupName n ON n.GroupId = g.GroupId
  WHERE g.GroupingId=@GroupingId
  ORDER BY g.OrderIndex;
END
GO

IF OBJECT_ID('dbo.usp_SaveNodes','P') IS NOT NULL DROP PROCEDURE dbo.usp_SaveNodes;
GO
CREATE PROCEDURE dbo.usp_SaveNodes
  @ProjectId INT,
  @GroupingId INT,
  @NodesJson NVARCHAR(MAX) -- [{"index":0,"isNode":true,"en":"Employee","ar":"موظف","labelKey":"Employee"}, ...]
AS
BEGIN
  SET NOCOUNT ON;
  ;WITH j AS (
    SELECT TRY_CAST(JSON_VALUE(value,'$.index') AS INT) AS NodeIndex,
           TRY_CAST(JSON_VALUE(value,'$.isNode') AS BIT) AS IsNode,
           JSON_VALUE(value,'$.en') AS LabelEn,
           JSON_VALUE(value,'$.ar') AS LabelAr,
           JSON_VALUE(value,'$.labelKey') AS LabelKey
    FROM OPENJSON(@NodesJson)
  )
  MERGE dbo.NodeDef AS t
  USING (
    SELECT @ProjectId AS ProjectId, g.GroupId, g.OrderIndex AS NodeIndex, j.IsNode,
           NULLIF(j.LabelKey,'') AS LabelKey, j.LabelEn, j.LabelAr
    FROM j
    JOIN dbo.[Group] g ON g.GroupingId=@GroupingId AND g.OrderIndex=j.NodeIndex
  ) AS s
  ON t.ProjectId=s.ProjectId AND t.NodeIndex=s.NodeIndex
  WHEN MATCHED THEN UPDATE SET t.IsNode=s.IsNode, t.LabelKey=s.LabelKey, t.LabelEn=s.LabelEn, t.LabelAr=s.LabelAr, t.GroupId=s.GroupId
  WHEN NOT MATCHED THEN INSERT(ProjectId, GroupId, NodeIndex, IsNode, LabelKey, LabelEn, LabelAr)
                       VALUES(s.ProjectId, s.GroupId, s.NodeIndex, s.IsNode, s.LabelKey, s.LabelEn, s.LabelAr);

  SELECT NodeId, NodeIndex, IsNode, LabelKey, LabelEn, LabelAr FROM dbo.NodeDef WHERE ProjectId=@ProjectId ORDER BY NodeIndex;
END
GO

IF OBJECT_ID('dbo.usp_SaveRelationships','P') IS NOT NULL DROP PROCEDURE dbo.usp_SaveRelationships;
GO
CREATE PROCEDURE dbo.usp_SaveRelationships
  @ProjectId INT,
  @RelsJson NVARCHAR(MAX) -- [{"include":true,"from":0,"to":1,"en":"WORKS_IN","ar":"يعمل في","dir":"out","typeKey":"WORKS_IN"}, ...]
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @Nodes TABLE(NodeId INT, NodeIndex INT);
  INSERT INTO @Nodes(NodeId, NodeIndex)
  SELECT NodeId, NodeIndex FROM dbo.NodeDef WHERE ProjectId=@ProjectId AND IsNode=1;

  ;WITH j AS (
    SELECT TRY_CAST(JSON_VALUE(value,'$.from') AS INT) AS FromIndex,
           TRY_CAST(JSON_VALUE(value,'$.to') AS INT)   AS ToIndex,
           TRY_CAST(JSON_VALUE(value,'$.include') AS BIT) AS IncludeFlg,
           JSON_VALUE(value,'$.en') AS NameEn,
           JSON_VALUE(value,'$.ar') AS NameAr,
           JSON_VALUE(value,'$.dir') AS Dir,
           JSON_VALUE(value,'$.typeKey') AS TypeKey
    FROM OPENJSON(@RelsJson)
  )
  MERGE dbo.RelationshipDef AS t
  USING (
    SELECT @ProjectId AS ProjectId,
           nf.NodeId AS FromNodeId,
           nt.NodeId AS ToNodeId,
           ISNULL(NULLIF(j.TypeKey,''), NULLIF(j.NameEn,'')) AS TypeKey,
           j.NameEn, j.NameAr,
           CASE WHEN j.Dir IN ('out','in','both') THEN j.Dir ELSE 'out' END AS Direction,
           ISNULL(j.IncludeFlg, 0) AS IncludeFlg
    FROM j
    JOIN @Nodes nf ON nf.NodeIndex = j.FromIndex
    JOIN @Nodes nt ON nt.NodeIndex = j.ToIndex
    WHERE nf.NodeId IS NOT NULL AND nt.NodeId IS NOT NULL AND nf.NodeId <> nt.NodeId
  ) AS s
  ON t.ProjectId=s.ProjectId AND t.FromNodeId=s.FromNodeId AND t.ToNodeId=s.ToNodeId
  WHEN MATCHED THEN UPDATE SET t.TypeKey=s.TypeKey, t.NameEn=s.NameEn, t.NameAr=s.NameAr, t.Direction=s.Direction, t.Include=s.IncludeFlg
  WHEN NOT MATCHED THEN INSERT(ProjectId, FromNodeId, ToNodeId, TypeKey, NameEn, NameAr, Direction, Include)
                       VALUES(s.ProjectId, s.FromNodeId, s.ToNodeId, s.TypeKey, s.NameEn, s.NameAr, s.Direction, s.IncludeFlg);

  SELECT RelId, FromNodeId, ToNodeId, TypeKey, NameEn, NameAr, Direction, Include FROM dbo.RelationshipDef WHERE ProjectId=@ProjectId;
END
GO
