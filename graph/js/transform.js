// Data transformation utilities
(function(){
  window.App = window.App || {};

  // Build color map from master legend
  App.buildColors = function buildColors(legendConfig){
    const def = (legendConfig && legendConfig.types && legendConfig.types.default) || { color: '#ccc', borderColor: '#999' };
    const map = {};
    if (legendConfig && legendConfig.types){
      Object.keys(legendConfig.types).forEach((code)=>{
        const t = legendConfig.types[code] || {};
        map[code] = { color: t.color || def.color, borderColor: t.borderColor || def.borderColor };
      });
    }
    return { def, map };
  };

  // Accepts elements array [{ group, data }]
  App.transformNewElements = function transformNewElements(raw){
    if (!Array.isArray(raw)) return { nodes: [], edges: [] };
    const out = { nodes: [], edges: [] };
    const colors = App.colors || { def: { color:'#ccc', borderColor:'#999' }, map: {} };
    raw.forEach((el, idx)=>{
      if (!el || !el.group || !el.data) return;
      if (el.group === 'nodes'){
        const d = { ...el.data };
        d.EN = d.EN || d.ETEn || String(d.ID || d.id || idx + 1);
        d.AR = d.AR || d.ETAr || String(d.ID || d.id || idx + 1);
        const c = colors.map[d.ETCode] || colors.def;
        d.color = d.color || c.color;
        d.borderColor = d.borderColor || c.borderColor;
        out.nodes.push({ group: 'nodes', data: d });
      } else if (el.group === 'edges') {
        const d = { ...el.data };
        d.id = d.id || `e_${idx+1}`;
        d.nameEn = d.nameEn || d.EN || d.RTEn || 'Connection';
        d.nameAr = d.nameAr || d.AR || d.RTAr || '?????';
        out.edges.push({ group: 'edges', data: d });
      }
    });
    return out;
  };
})();

