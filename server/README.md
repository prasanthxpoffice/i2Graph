# LLM Proxy (Dev/Prod)

Secure backend proxy for OpenAI-compatible chat completions. Keeps API keys off the client.

## Quick Start (Dev)

1. Copy `.env.example` to `.env` and set values:
   - `OPENAI_API_KEY=sk-...`
   - `ALLOWED_ORIGINS=http://localhost:5500` (default Python `http.server` port in `openner.bat`)
   - `PORT=8787`
2. Install and run (Node >= 18):

```
cd server
npm install
npm start
```

3. Point the frontend at the proxy by setting before `/llm/index.js`:

```
<script>
  window.LLM_CONFIG = { provider: 'openai', apiBase: 'http://localhost:8787/api', model: 'gpt-4o-mini' };
</script>
```

Now all LLM calls use the proxy; no client-side key is needed.

## Production Notes

- Host this service alongside your static site and proxy `/api/*` to it at the edge or web server.
- Keep `.env` out of source control.
- Harden further as needed (auth, quotas, logging).

## Endpoints

- `GET /api/health` – basic health
- `POST /api/chat/completions` – forwards to OpenAI Chat Completions

## Security

- CORS restricted via `ALLOWED_ORIGINS`
- Rate-limited (60 requests/min per IP)
- Helmet security headers
- JSON size limit (100kb)

