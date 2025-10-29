// Global LLM config used by all pages
// Dev: point to proxy server with full origin
// Prod: change apiBase to '/api' when reverse-proxied on same origin
window.LLM_CONFIG = {
  apiBase: 'http://localhost:8787/api'
};
