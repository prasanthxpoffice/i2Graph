/*
  LLM Proxy Server (renamed from index.js)
  - Minimal secure proxy for OpenAI-compatible chat completions.
  - Requires Node >= 18 (global fetch)
  - Reads env from server/.env (see .env.example)
  - Adds CORS (allowed origins), Helmet, rate limiting, and JSON/body limits
*/
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');

dotenv.config();

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_API_BASE = (process.env.OPENAI_API_BASE || 'https://api.openai.com/v1').replace(/\/$/, '');
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:5500')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

if (!OPENAI_API_KEY) {
  // Start anyway so health endpoint can inform user, but log a warning
  console.warn('[WARN] OPENAI_API_KEY is not set. /api/chat/completions will return 500.');
}

const app = express();

// Security headers
app.use(helmet());

// CORS (restrict to known dev origin by default)
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true); // allow non-browser clients
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: false
}));

// Rate limiting (per IP)
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', limiter);

// JSON body parser with size limit
app.use(express.json({ limit: '100kb' }));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true, model: OPENAI_MODEL, apiBase: OPENAI_API_BASE, hasKey: !!OPENAI_API_KEY });
});

// Proxy for OpenAI Chat Completions
app.post('/api/chat/completions', async (req, res) => {
  try {
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: 'Server LLM key not configured.' });
    }
    const { messages, temperature } = req.body || {};
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages must be an array' });
    }
    const body = {
      // Server decides the model; ignore client-provided model for safety
      model: OPENAI_MODEL,
      messages,
      temperature: typeof temperature === 'number' ? temperature : 0.2
    };
    const r = await fetch(OPENAI_API_BASE + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + OPENAI_API_KEY
      },
      body: JSON.stringify(body)
    });
    const data = await r.json();
    // Pass through the provider response so the frontend stays compatible
    res.status(r.status).json(data);
  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).json({ error: 'Proxy error' });
  }
});

app.listen(PORT, () => {
  console.log(`[LLM Proxy] Listening on http://localhost:${PORT}`);
  console.log(`[LLM Proxy] Allowing CORS from: ${ALLOWED_ORIGINS.join(', ') || 'ANY'}`);
});
