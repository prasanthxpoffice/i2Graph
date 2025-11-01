/* iGraph schema bootstrap (SQL Server 2016+ for JSON)
   - Creates schema iGraph if missing
   - Creates tables under iGraph: Datatables, Grouping, [Group], GroupName, NodeDef, RelationshipDef
   - Creates procedures: iGraph.usp_CreateDatatable, iGraph.usp_SaveGraphDefinition, iGraph.usp_DeleteDatatable
   Safe to run multiple times (IF OBJECT_ID checks).
*/
SET NOCOUNT ON;

-- Ensure SQL 2016+ JSON support (OPENJSON)
-- ALTER DATABASE CURRENT SET COMPATIBILITY_LEVEL = 130; -- uncomment if needed

-- Schema
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'iGraph')
  EXEC('CREATE SCHEMA iGraph');

/* Tables */
IF OBJECT_ID('iGraph.Datatables','U') IS NULL
CREATE TABLE iGraph.Datatables (
  DatatableId INT IDENTITY(1,1) PRIMARY KEY,
  Name        NVARCHAR(200) NOT NULL,
  CsvData     VARBINARY(MAX) NULL,
  CreatedBy   INT NOT NULL,
  ModifiedBy  INT NULL,
  CreatedAt   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  UpdatedAt   DATETIME2 NULL
);

IF OBJECT_ID('iGraph.Grouping','U') IS NULL
CREATE TABLE iGraph.Grouping (
  GroupingId  INT IDENTITY(1,1) PRIMARY KEY,
  DatatableId INT NOT NULL REFERENCES iGraph.Datatables(DatatableId),
  CreatedAt   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  UpdatedAt   DATETIME2 NULL,
  Status      NVARCHAR(20) NOT NULL DEFAULT 'active'
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_Grouping_Datatable_Active' AND object_id=OBJECT_ID('iGraph.Grouping'))
  CREATE UNIQUE INDEX UX_Grouping_Datatable_Active ON iGraph.Grouping(DatatableId, Status) WHERE Status='active';

IF OBJECT_ID('iGraph.[Group]','U') IS NULL
CREATE TABLE iGraph.[Group] (
  GroupId    INT IDENTITY(1,1) PRIMARY KEY,
  GroupingId INT NOT NULL REFERENCES iGraph.Grouping(GroupingId) ON DELETE CASCADE,
  OrderIndex INT NOT NULL,
  IdCol      NVARCHAR(128) NOT NULL,
  EnCol      NVARCHAR(128) NOT NULL,
  ArCol      NVARCHAR(128) NOT NULL
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Group_Grouping_Order' AND object_id=OBJECT_ID('iGraph.[Group]'))
  CREATE INDEX IX_Group_Grouping_Order ON iGraph.[Group](GroupingId, OrderIndex);

IF OBJECT_ID('iGraph.GroupName','U') IS NULL
CREATE TABLE iGraph.GroupName (
  GroupNameId INT IDENTITY(1,1) PRIMARY KEY,
  GroupId     INT NOT NULL REFERENCES iGraph.[Group](GroupId) ON DELETE CASCADE,
  NameEn      NVARCHAR(200) NOT NULL,
  NameAr      NVARCHAR(200) NULL,
  CreatedAt   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_GroupName_Group' AND object_id=OBJECT_ID('iGraph.GroupName'))
  CREATE UNIQUE INDEX UX_GroupName_Group ON iGraph.GroupName(GroupId);

IF OBJECT_ID('iGraph.NodeDef','U') IS NULL
CREATE TABLE iGraph.NodeDef (
  NodeId      INT IDENTITY(1,1) PRIMARY KEY,
  GroupId     INT NOT NULL REFERENCES iGraph.[Group](GroupId) ON DELETE CASCADE,
  NodeIndex   INT NOT NULL,
  IsNode      BIT NOT NULL,
  LabelKey    NVARCHAR(128) NULL,
  LabelEn     NVARCHAR(200) NULL,
  LabelAr     NVARCHAR(200) NULL,
  CreatedAt   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_NodeDef_Group' AND object_id=OBJECT_ID('iGraph.NodeDef'))
  CREATE UNIQUE INDEX UX_NodeDef_Group ON iGraph.NodeDef(GroupId);

IF OBJECT_ID('iGraph.RelationshipDef','U') IS NULL
CREATE TABLE iGraph.RelationshipDef (
  RelId       INT IDENTITY(1,1) PRIMARY KEY,
  FromNodeId  INT NOT NULL REFERENCES iGraph.NodeDef(NodeId) ON DELETE CASCADE,
  ToNodeId    INT NOT NULL REFERENCES iGraph.NodeDef(NodeId) ON DELETE CASCADE,
  TypeKey     NVARCHAR(128) NULL,
  NameEn      NVARCHAR(200) NULL,
  NameAr      NVARCHAR(200) NULL,
  Direction   NVARCHAR(8) NOT NULL CHECK (Direction IN ('out','in','both')),
  Include     BIT NOT NULL DEFAULT 1,
  CreatedAt   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
-- Ensure single relationship per node pair
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Rel_FromTo' AND object_id=OBJECT_ID('iGraph.RelationshipDef'))
  DROP INDEX IX_Rel_FromTo ON iGraph.RelationshipDef;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_Rel_FromTo' AND object_id=OBJECT_ID('iGraph.RelationshipDef'))
  CREATE UNIQUE INDEX UX_Rel_FromTo ON iGraph.RelationshipDef(FromNodeId, ToNodeId);

/* Procedures */
IF OBJECT_ID('iGraph.usp_CreateDatatable','P') IS NOT NULL DROP PROCEDURE iGraph.usp_CreateDatatable;
GO
CREATE PROCEDURE iGraph.usp_CreateDatatable
  @Name NVARCHAR(200),
  @CreatedBy INT,
  @CsvData VARBINARY(MAX) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO iGraph.Datatables(Name, CreatedBy, CsvData) VALUES(@Name, @CreatedBy, @CsvData);
  SELECT SCOPE_IDENTITY() AS DatatableId;
END
GO

IF OBJECT_ID('iGraph.usp_SaveGraphDefinition','P') IS NOT NULL DROP PROCEDURE iGraph.usp_SaveGraphDefinition;
GO
CREATE PROCEDURE iGraph.usp_SaveGraphDefinition
  @DatatableId INT,
  @Payload NVARCHAR(MAX),
  @UserId INT = NULL
AS
BEGIN
  SET NOCOUNT ON;
  BEGIN TRY
    BEGIN TRAN;

      DECLARE @GroupingId INT;
      SELECT TOP 1 @GroupingId = GroupingId
      FROM iGraph.Grouping
      WHERE DatatableId=@DatatableId AND Status='active'
      ORDER BY GroupingId DESC;

      IF @GroupingId IS NULL
      BEGIN
        INSERT INTO iGraph.Grouping(DatatableId) VALUES(@DatatableId);
        SET @GroupingId = SCOPE_IDENTITY();
      END
      ELSE
      BEGIN
        UPDATE iGraph.Grouping SET UpdatedAt=SYSUTCDATETIME() WHERE GroupingId=@GroupingId;
      END

      IF @UserId IS NOT NULL
        UPDATE iGraph.Datatables SET ModifiedBy=@UserId, UpdatedAt=SYSUTCDATETIME() WHERE DatatableId=@DatatableId;

      ;WITH gjson AS (
        SELECT TRY_CAST(JSON_VALUE(value,'$.index') AS INT) AS OrderIndex,
               NULLIF(JSON_VALUE(value,'$.idCol'),'') AS IdCol,
               NULLIF(JSON_VALUE(value,'$.enCol'),'') AS EnCol,
               NULLIF(JSON_VALUE(value,'$.arCol'),'') AS ArCol,
               NULLIF(JSON_VALUE(value,'$.nameEn'),'') AS NameEn,
               NULLIF(JSON_VALUE(value,'$.nameAr'),'') AS NameAr
        FROM OPENJSON(@Payload, '$.grouping.groups')
      )
      BEGIN
        DELETE FROM iGraph.[Group] WHERE GroupingId=@GroupingId;
        INSERT INTO iGraph.[Group](GroupingId, OrderIndex, IdCol, EnCol, ArCol)
        SELECT @GroupingId, OrderIndex, IdCol, EnCol, ArCol FROM gjson;
        INSERT INTO iGraph.GroupName(GroupId, NameEn, NameAr)
        SELECT g.GroupId, j.NameEn, j.NameAr
        FROM gjson j
        JOIN iGraph.[Group] g ON g.GroupingId=@GroupingId AND g.OrderIndex=j.OrderIndex
        WHERE (j.NameEn IS NOT NULL OR j.NameAr IS NOT NULL);
      END

      ;WITH njson AS (
        SELECT TRY_CAST(JSON_VALUE(value,'$.index') AS INT) AS NodeIndex,
               TRY_CAST(JSON_VALUE(value,'$.isNode') AS BIT) AS IsNode,
               NULLIF(JSON_VALUE(value,'$.labelKey'),'') AS LabelKey,
               NULLIF(JSON_VALUE(value,'$.en'),'') AS LabelEn,
               NULLIF(JSON_VALUE(value,'$.ar'),'') AS LabelAr
        FROM OPENJSON(@Payload, '$.nodes')
      )
      MERGE iGraph.NodeDef AS t
      USING (
        SELECT g.GroupId, g.OrderIndex AS NodeIndex, n.IsNode, n.LabelKey, n.LabelEn, n.LabelAr
        FROM njson n
        JOIN iGraph.[Group] g ON g.GroupingId=@GroupingId AND g.OrderIndex=n.NodeIndex
      ) AS s
      ON t.GroupId=s.GroupId
      WHEN MATCHED THEN UPDATE SET t.IsNode=s.IsNode, t.NodeIndex=s.NodeIndex, t.LabelKey=s.LabelKey, t.LabelEn=s.LabelEn, t.LabelAr=s.LabelAr
      WHEN NOT MATCHED THEN INSERT(GroupId, NodeIndex, IsNode, LabelKey, LabelEn, LabelAr)
                           VALUES(s.GroupId, s.NodeIndex, s.IsNode, s.LabelKey, s.LabelEn, s.LabelAr);

      DELETE t
      FROM iGraph.NodeDef t
      JOIN iGraph.[Group] g ON g.GroupId = t.GroupId
      WHERE g.GroupingId=@GroupingId
        AND NOT EXISTS (SELECT 1 FROM njson n WHERE n.NodeIndex = g.OrderIndex);

      ;WITH j AS (
        SELECT TRY_CAST(JSON_VALUE(value,'$.from') AS INT) AS FromIndex,
               TRY_CAST(JSON_VALUE(value,'$.to') AS INT)   AS ToIndex,
               TRY_CAST(JSON_VALUE(value,'$.include') AS BIT) AS IncludeFlg,
               NULLIF(JSON_VALUE(value,'$.en'),'') AS NameEn,
               NULLIF(JSON_VALUE(value,'$.ar'),'') AS NameAr,
               JSON_VALUE(value,'$.dir') AS Dir,
               NULLIF(JSON_VALUE(value,'$.typeKey'),'') AS TypeKey
        FROM OPENJSON(@Payload, '$.relationships')
      ),
      nodes AS (
        SELECT nd.NodeId, g.OrderIndex AS NodeIndex
        FROM iGraph.NodeDef nd
        JOIN iGraph.[Group] g ON g.GroupId=nd.GroupId
        WHERE g.GroupingId=@GroupingId AND nd.IsNode=1
      ),
      candidates AS (
        SELECT 
               nf.NodeId AS FromNodeId,
               nt.NodeId AS ToNodeId,
               ISNULL(NULLIF(j.TypeKey,''), NULLIF(j.NameEn,'')) AS TypeKey,
               j.NameEn,
               j.NameAr,
               CASE WHEN j.Dir IN ('out','in','both') THEN j.Dir ELSE 'out' END AS Direction,
               ISNULL(j.IncludeFlg, 1) AS Include
        FROM j
        JOIN nodes nf ON nf.NodeIndex = j.FromIndex
        JOIN nodes nt ON nt.NodeIndex = j.ToIndex
        WHERE nf.NodeId IS NOT NULL AND nt.NodeId IS NOT NULL AND nf.NodeId <> nt.NodeId
      )
      MERGE iGraph.RelationshipDef AS t
      USING candidates AS s
      ON t.FromNodeId=s.FromNodeId AND t.ToNodeId=s.ToNodeId
      WHEN MATCHED THEN UPDATE SET t.TypeKey=s.TypeKey, t.NameEn=s.NameEn, t.NameAr=s.NameAr, t.Direction=s.Direction, t.Include=s.Include
      WHEN NOT MATCHED THEN INSERT(FromNodeId, ToNodeId, TypeKey, NameEn, NameAr, Direction, Include)
                           VALUES(s.FromNodeId, s.ToNodeId, s.TypeKey, s.NameEn, s.NameAr, s.Direction, s.Include)
      WHEN NOT MATCHED BY SOURCE AND t.FromNodeId IN (SELECT NodeId FROM nodes) AND t.ToNodeId IN (SELECT NodeId FROM nodes) THEN DELETE;

    COMMIT TRAN;
    SELECT GroupingId=@GroupingId;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT>0 ROLLBACK TRAN;
    THROW;
  END CATCH
END
GO

IF OBJECT_ID('iGraph.usp_DeleteDatatable','P') IS NOT NULL DROP PROCEDURE iGraph.usp_DeleteDatatable;
GO
CREATE PROCEDURE iGraph.usp_DeleteDatatable
  @DatatableId INT
AS
BEGIN
  SET NOCOUNT ON;
  BEGIN TRY
    BEGIN TRAN;
      DECLARE @Nodes TABLE(NodeId INT PRIMARY KEY);
      INSERT INTO @Nodes(NodeId)
      SELECT nd.NodeId
      FROM iGraph.NodeDef nd
      JOIN iGraph.[Group] g ON g.GroupId=nd.GroupId
      JOIN iGraph.Grouping grp ON grp.GroupingId=g.GroupingId AND grp.DatatableId=@DatatableId;

      DELETE FROM iGraph.RelationshipDef WHERE FromNodeId IN (SELECT NodeId FROM @Nodes) OR ToNodeId IN (SELECT NodeId FROM @Nodes);
      DELETE FROM iGraph.NodeDef WHERE NodeId IN (SELECT NodeId FROM @Nodes);
      DELETE g
      FROM iGraph.[Group] g
      JOIN iGraph.Grouping grp ON grp.GroupingId=g.GroupingId AND grp.DatatableId=@DatatableId;
      DELETE FROM iGraph.Grouping WHERE DatatableId=@DatatableId;
      DELETE FROM iGraph.Datatables WHERE DatatableId=@DatatableId;
    COMMIT TRAN;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT>0 ROLLBACK TRAN;
    THROW;
  END CATCH
END
GO
