// Entry point: load config, data, init UI + graph
(function(){
  window.App = window.App || {};

  async function initGraphApp(){
    try {
      const [cfg, legend, raw] = await Promise.all([
        App.loadConfig(),
        fetch('/master.json', { cache: 'no-store' }).then(r=>{ if(!r.ok) throw new Error('master.json '+r.status); return r.json(); }).catch(()=>{ return null; }),
        fetch('/data.json', { cache: 'no-store' }).then(r=>{ if(!r.ok) throw new Error('data.json '+r.status); return r.json(); })
      ]);
      App.colors = App.buildColors(legend);
      const baseData = App.transformNewElements(raw);
      App.baseData = baseData;
      App.buildIndexes(baseData);
      App.ui.init(legend);
    } catch (e) {
      const el = document.getElementById('status-message');
      if (el){ el.textContent = 'Initialization failed. Check console.'; el.classList.remove('opacity-0'); }
    }
  }

  function destroyGraphApp(){
    try {
      if (window.App) {
        if (App.cy && !App.cy.destroyed()) { App.cy.destroy(); }
        if (App.graph && App.graph.cxtmenuApi && typeof App.graph.cxtmenuApi.destroy === 'function') {
          try { App.graph.cxtmenuApi.destroy(); } catch {}
          App.graph.cxtmenuApi = null;
        }
      }
    } catch {}
  }

  // Expose lifecycle for SPA router
  window.App.initGraphApp = initGraphApp;
  window.App.destroyGraphApp = destroyGraphApp;

  // Support SPA: if document already loaded, run immediately; else wait for load
  if (document.readyState === 'complete') {
    initGraphApp();
  } else {
    window.addEventListener('load', initGraphApp, { once: true });
  }
})();
