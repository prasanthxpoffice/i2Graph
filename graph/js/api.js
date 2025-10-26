// API adapter (search and expansion)
(function(){
  window.App = window.App || {};

  App.api = {
    async getGraphForFilters(filters, depth){
      const max = (App.config && (App.config.batchSize ?? 200)) || 200;
      const res = await App.apiFetch(`${App.config.apiBaseUrl}/graph/search`, {
        method: 'POST', headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ filters, depth, max })
      });
      const json = await res.json();
      // Expect elements array
      return App.transformNewElements(json);
    },
    async getExpansionForNode(nodeId, depth){
      const max = (App.config && (App.config.batchSize ?? 200)) || 200;
      const res = await App.apiFetch(`${App.config.apiBaseUrl}/graph/expand`, {
        method: 'POST', headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ nodeId, depth, max })
      });
      const json = await res.json();
      return App.transformNewElements(json);
    }
  };
})();

