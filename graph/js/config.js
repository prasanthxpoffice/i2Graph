// Config and API fetch wrapper
// - Loads config.json
// - Provides App.config and App.apiFetch (routes to fake API or real fetch)
(function () {
  window.App = window.App || {};

  App.config = null;

  App.setConfig = function setConfig(cfg) {
    App.config = cfg || {};
  };

  App.loadConfig = async function loadConfig() {
    try {
      const res = await fetch('/config.json', { cache: 'no-store' });
      const json = await res.json();
      if (!json || !json.apiBaseUrl) throw new Error('apiBaseUrl missing');
      App.setConfig(json);
      return App.config;
    } catch (e) {
      console.error('Failed to load config.json:', e);
      throw e;
    }
  };

  App.apiFetch = function apiFetch(url, options) {
    const base = App.config && App.config.apiBaseUrl;
    // Use fake API when configured
    if (base === 'fakeapi' && typeof window.fakeApiFetch === 'function') {
      return window.fakeApiFetch(url, options);
    }
    return fetch(url, options);
  };
})();
