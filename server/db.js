/*
  DB API Server
  - Exposes endpoints to persist graph definition to SQL Server using stored procedures.
  - Reads MSSQL connection string from process.env.MSSQL
  - Endpoints:
      GET  /db/health
      POST /db/saveGraphDefinition { projectId:number, payload:object }
*/
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');

dotenv.config();

const PORT = process.env.DB_PORT ? Number(process.env.DB_PORT) : 8788;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:5500')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const MSSQL_CS = process.env.MSSQL || '';

const app = express();

app.use(helmet());
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: false
}));

const limiter = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false });
app.use('/db/', limiter);
app.use(express.json({ limit: '512kb' }));

// Lazy require to avoid crashing if dependency not installed yet
let sql; try { sql = require('mssql'); } catch { sql = null; }

async function withPool(fn) {
  if (!sql) throw new Error('Missing dependency: mssql. Run: npm i mssql');
  if (!MSSQL_CS) throw new Error('MSSQL connection string not configured');
  const pool = new sql.ConnectionPool(MSSQL_CS);
  const conn = await pool.connect();
  try { return await fn(conn); }
  finally { conn.close(); }
}

app.get('/db/health', async (req, res) => {
  try {
    if (!sql || !MSSQL_CS) return res.json({ ok: false, hasDriver: !!sql, hasConn: !!MSSQL_CS });
    await withPool(async (conn) => { await conn.request().query('SELECT 1 AS ok'); });
    res.json({ ok: true, hasDriver: true, hasConn: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
});

// Save entire graph definition in one shot using dbo.usp_SaveGraphDefinition
app.post('/db/saveGraphDefinition', async (req, res) => {
  try {
    const { projectId, payload, userId } = req.body || {};
    if (typeof projectId !== 'number' || !Number.isFinite(projectId)) {
      return res.status(400).json({ error: 'projectId must be a number' });
    }
    const json = JSON.stringify(payload || {});
    const result = await withPool(async (conn) => {
      const r = await conn.request()
        .input('ProjectId', sql.Int, projectId)
        .input('Payload', sql.NVarChar(sql.MAX), json)
        .input('UserId', sql.Int, (typeof userId === 'number' && Number.isFinite(userId)) ? userId : 1001)
        .execute('dbo.usp_SaveGraphDefinition');
      return { recordsets: r.recordsets, rowsAffected: r.rowsAffected, output: r.output };
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
});

// Delete entire project (and all related defs) via dbo.usp_DeleteProject
app.post('/db/deleteProject', async (req, res) => {
  try {
    const { projectId } = req.body || {};
    if (typeof projectId !== 'number' || !Number.isFinite(projectId)) {
      return res.status(400).json({ error: 'projectId must be a number' });
    }
    const result = await withPool(async (conn) => {
      const r = await conn.request()
        .input('ProjectId', sql.Int, projectId)
        .execute('dbo.usp_DeleteProject');
      return { rowsAffected: r.rowsAffected };
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
});

app.listen(PORT, () => {
  console.log(`[DB API] Listening on http://localhost:${PORT}`);
  console.log(`[DB API] Allowing CORS from: ${ALLOWED_ORIGINS.join(', ') || 'ANY'}`);
});
