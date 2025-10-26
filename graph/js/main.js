// Entry point: load config, data, init UI + graph
(function(){
  window.App = window.App || {};

  window.addEventListener('load', async ()=>{
    try {
      // Load config, legend, data
      const [cfg, legend, raw] = await Promise.all([
        App.loadConfig(),
        fetch('../master.json').then(r=>r.json()).catch(()=>null),
        fetch('../data.json').then(r=>r.json())
      ]);

      // Colors
      App.colors = App.buildColors(legend);
      // Transform data
      const baseData = App.transformNewElements(raw);
      App.baseData = baseData;
      App.buildIndexes(baseData);

      // Init UI and initial search
      App.ui.init(legend);
    } catch (e) {
      console.error(e);
      const el = document.getElementById('status-message');
      if (el){ el.textContent = 'Initialization failed. Check console.'; el.classList.remove('opacity-0'); }
    }
  });
})();
