// Simple in-page fake API to simulate backend endpoints
// Exposes window.fakeApiFetch(url, options) returning a Response-like object
(function () {
  let cache = null; // cached elements array from data.json

  async function loadData() {
    if (cache) return cache;
    const res = await fetch('/data.json', { cache: 'no-store' });
    const json = await res.json();
    cache = Array.isArray(json) ? json : [];
    return cache;
  }

  function toElements(raw) {
    return Array.isArray(raw) ? raw : [];
  }

  function elementsToMaps(elements) {
    const nodes = elements.filter(e => e.group === 'nodes');
    const edges = elements.filter(e => e.group === 'edges');
    const nodeById = new Map(nodes.map(n => [n.data.id, n]));
    const adj = new Map();
    edges.forEach(e => {
      const s = e.data.source, t = e.data.target;
      if (!adj.has(s)) adj.set(s, new Set());
      if (!adj.has(t)) adj.set(t, new Set());
      adj.get(s).add(e);
      adj.get(t).add(e);
    });
    return { nodes, edges, nodeById, adj };
  }

  function matchValues(data, values, mode) {
    const norm = s => String(s ?? '').toLowerCase().trim();
    const cand = [data.ID, data.EN, data.AR].map(norm).filter(Boolean);
    const vlist = values.map(norm).filter(Boolean);
    if (mode === 'contains') return cand.some(c => vlist.some(v => c.includes(v)));
    const set = new Set(vlist);
    return cand.some(c => set.has(c));
  }

  function filterByFilters(elements, filters, depth, max) {
    const { nodes, edges, nodeById, adj } = elementsToMaps(elements);
    const outNodes = new Map();
    const outEdges = new Map();
    // seed
    const frontier = new Set();
    filters.forEach(f => {
      nodes.forEach(n => {
        if (n.data.ETCode === f.entityType && matchValues(n.data, f.values, f.match)) {
          if (!outNodes.has(n.data.id)) outNodes.set(n.data.id, n);
          frontier.add(n.data.id);
        }
      });
    });
    // bfs
    for (let d = 0; d < depth; d++) {
      if (frontier.size === 0) break;
      const next = new Set();
      for (const id of frontier) {
        const set = adj.get(id);
        if (!set) continue;
        for (const e of set) {
          const s = e.data.source, t = e.data.target;
          const fromSource = id === s, fromTarget = id === t;
          let allowed = false;
          for (const f of filters) {
            if ((fromSource && (f.direction === 'both' || f.direction === 'out')) ||
                (fromTarget && (f.direction === 'both' || f.direction === 'in'))) { allowed = true; break; }
          }
          if (!allowed) continue;
          if (!outEdges.has(e.data.id)) outEdges.set(e.data.id, e);
          const other = fromSource ? t : s;
          if (!outNodes.has(other) && nodeById.get(other)) outNodes.set(other, nodeById.get(other));
          if (!frontier.has(other)) next.add(other);
          if (max && (outNodes.size + outEdges.size) >= max) break;
        }
        if (max && (outNodes.size + outEdges.size) >= max) break;
      }
      frontier.clear();
      next.forEach(n => frontier.add(n));
      if (max && (outNodes.size + outEdges.size) >= max) break;
    }
    // connect internal edges fully
    edges.forEach(e => {
      if (outNodes.has(e.data.source) && outNodes.has(e.data.target)) outEdges.set(e.data.id, e);
    });
    return [
      ...Array.from(outNodes.values()),
      ...Array.from(outEdges.values())
    ];
  }

  async function fakeApiFetch(url, options = {}) {
    const u = String(url);
    if (!u.includes('/graph/')) {
      // passthrough
      return fetch(url, options);
    }
    const body = options && options.body ? JSON.parse(options.body) : {};
    const { filters = [], depth = 1, nodeId, max } = body;
    const elements = await loadData().then(toElements);
    let result = [];
    if (u.endsWith('/graph/search')) {
      result = filterByFilters(elements, filters, depth, max);
    } else if (u.endsWith('/graph/expand')) {
      // Expand from nodeId using BFS ignoring ETCode/filters
      const { nodeById, adj } = elementsToMaps(elements);
      if (!nodeId || !nodeById.has(nodeId)) {
        result = [];
      } else {
        const outNodes = new Map();
        const outEdges = new Map();
        let frontier = new Set([nodeId]);
        outNodes.set(nodeId, nodeById.get(nodeId));
        for (let d = 0; d < depth; d++) {
          if (frontier.size === 0) break;
          const next = new Set();
          for (const id of frontier) {
            const set = adj.get(id);
            if (!set) continue;
            for (const e of set) {
              const s = e.data.source, t = e.data.target;
              const other = id === s ? t : s;
              outEdges.set(e.data.id, e);
              if (nodeById.get(other)) outNodes.set(other, nodeById.get(other));
              if (!frontier.has(other)) next.add(other);
              if (max && (outNodes.size + outEdges.size) >= max) break;
            }
            if (max && (outNodes.size + outEdges.size) >= max) break;
          }
          frontier.clear();
          next.forEach(n => frontier.add(n));
          if (max && (outNodes.size + outEdges.size) >= max) break;
        }
        // ensure internal edges included
        elements.filter(e=>e.group==='edges').forEach(e=>{
          if (outNodes.has(e.data.source) && outNodes.has(e.data.target)) outEdges.set(e.data.id, e);
        });
        result = [ ...Array.from(outNodes.values()), ...Array.from(outEdges.values()) ];
      }
    }
    return {
      ok: true,
      json: async () => result,
    };
  }

  window.fakeApiFetch = fakeApiFetch;
})();
