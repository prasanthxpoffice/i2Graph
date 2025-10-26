// Indexes and BFS utilities
(function(){
  window.App = window.App || {};

  App.indexes = { nodeById: new Map(), edgeById: new Map(), adj: new Map() };

  App.buildIndexes = function buildIndexes(data){
    const nodeById = new Map(data.nodes.map(n=>[n.data.id, n]));
    const edgeById = new Map();
    const adj = new Map();
    data.edges.forEach((e)=>{
      edgeById.set(e.data.id, e);
      const s = e.data.source, t = e.data.target;
      if (!adj.has(s)) adj.set(s, new Set());
      if (!adj.has(t)) adj.set(t, new Set());
      adj.get(s).add(e);
      adj.get(t).add(e);
    });
    App.indexes = { nodeById, edgeById, adj };
  };

  // BFS from seed id up to depth (undirected)
  App.bfsFromSeedId = function bfsFromSeedId(data, seedId, depth){
    const nodes = new Map();
    const edges = new Map();
    const { nodeById, adj } = App.indexes;
    let frontier = new Set([seedId]);
    const seedNode = nodeById.get(seedId);
    if (seedNode) nodes.set(seedId, seedNode);
    for (let d = 0; d < depth; d++){
      const next = new Set();
      frontier.forEach((id)=>{
        const set = adj.get(id);
        if (!set) return;
        set.forEach((e)=>{
          const s=e.data.source, t=e.data.target;
          edges.set(e.data.id, e);
          if (nodeById.get(s)) nodes.set(s, nodeById.get(s));
          if (nodeById.get(t)) nodes.set(t, nodeById.get(t));
          const other = (id===s)?t:s;
          if (!frontier.has(other)) next.add(other);
        });
      });
      frontier = next;
      if (frontier.size===0) break;
    }
    // ensure internal edges included
    data.edges.forEach((e)=>{
      if (nodes.has(e.data.source) && nodes.has(e.data.target)) edges.set(e.data.id, e);
    });
    return { nodes: Array.from(nodes.values()), edges: Array.from(edges.values()) };
  };
})();

