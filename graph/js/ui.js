// UI wiring, filters, legend, search, expansion
(function(){
  window.App = window.App || {};

  const pendingExpansions = new Map(); // nodeId -> { nodes:[], edges:[] }

  App.useAnimate = function(){ const el = document.getElementById('layout-animate'); return el ? !!el.checked : true; };

  App.ui = {
    elements: {},
    // Pathfinding state
    isFindingPath: false,
    pathStartNode: null,
    init(legendConfig){
      const E = this.elements;
      E.languageSelect = document.getElementById('language-select');
      E.detailsContent = document.getElementById('details-content');
      E.depthInput = document.getElementById('depth');
      E.batchInput = document.getElementById('batch-size');
      E.filterContainer = document.getElementById('filter-container');
      E.addFilterBtn = document.getElementById('add-filter-btn');
      E.searchForm = document.getElementById('search-form');
      E.nodeSearch = document.getElementById('node-search');
      E.clearBtn = document.getElementById('clear-graph-btn');
      E.saveBtn = document.getElementById('save-png-btn');
      E.hubThreshold = document.getElementById('hub-threshold');
      E.findHubsBtn = document.getElementById('find-hubs-btn');
      E.findPathBtn = document.getElementById('find-path-btn');
      E.legendContainer = document.getElementById('legend-container');
      E.leftPanel = document.getElementById('left-panel');
      E.rightPanel = document.getElementById('right-panel');
      E.leftToggle = document.getElementById('left-toggle');
      E.rightToggle = document.getElementById('right-toggle');

      // Depth & Batch
      App.globalDepth = parseInt(E.depthInput?.value) || 2;
      E.depthInput && E.depthInput.addEventListener('change', ()=>{
        const v = parseInt(E.depthInput.value); App.globalDepth = Number.isFinite(v) && v>0 ? v : 1;
      });
      const initBatch = Math.min(500, Math.max(1, parseInt((App.config && App.config.batchSize) || 200)));
      if (E.batchInput){ E.batchInput.value = String(initBatch); App.config.batchSize = initBatch; E.batchInput.addEventListener('change', ()=>{
        const v = parseInt(E.batchInput.value); const clamped = Number.isFinite(v) ? Math.min(500, Math.max(1, v)) : 200; E.batchInput.value = String(clamped); App.config.batchSize = clamped; }); }

      // Legend
      this.buildLegendUI(legendConfig);
      this.applyLegendFilters();

      // Bind
      E.addFilterBtn && E.addFilterBtn.addEventListener('click', this.addFilter);
      // Delegated remove for any filter group's delete button (works for initial + dynamic)
      if (E.filterContainer){
        E.filterContainer.addEventListener('click', (ev)=>{
          const btn = ev.target.closest('.remove-filter-btn');
          if (btn){
            const group = btn.closest('.filter-group');
            if (group) group.remove();
          }
        });
      }
      E.searchForm && E.searchForm.addEventListener('submit', (e)=>{ e.preventDefault(); this.performSearch(); });
      // Panel toggles
      if (E.leftToggle && E.leftPanel){
        E.leftToggle.addEventListener('click', ()=>{
          E.leftPanel.classList.toggle('panel-hidden');
        });
      }
      if (E.rightToggle && E.rightPanel){
        E.rightToggle.addEventListener('click', ()=>{
          E.rightPanel.classList.toggle('panel-hidden');
        });
      }
      const layoutSelect = document.getElementById('layout-select');
      if (layoutSelect){
        layoutSelect.addEventListener('change', (e)=>{
          if (!App.cy || App.cy.destroyed() || App.cy.elements().length===0){ App.graph.showStatus('Graph is empty. Run a search first.'); return; }
          App.graph.runLayout(e.target.value);
        });
      }
      E.languageSelect && E.languageSelect.addEventListener('change', (e)=>{
        const cy = App.cy; if (!cy || cy.destroyed()) return;
        const lang = e.target.value; const nodeLabelStyle = `data(${lang})`; const edgeLabelStyle = `data(${lang==='EN'?'nameEn':'nameAr'})`;
        cy.style().selector('node').style('label', nodeLabelStyle).selector('edge').style('label', edgeLabelStyle).update();
        App.graph.showStatus(`Language switched to ${lang}.`);
      });
      E.nodeSearch && E.nodeSearch.addEventListener('input', (e)=>{
        const cy = App.cy; if (!cy || cy.destroyed()) return; const val = e.target.value.toLowerCase().trim();
        cy.batch(()=>{ App.ui.clearHighlights(); if (!val) return; const matches = cy.nodes().filter((n)=>{
          const id=(n.data('ID')||'').toLowerCase(), en=(n.data('EN')||'').toLowerCase(), ar=(n.data('AR')||'').toLowerCase();
          return id.includes(val)||en.includes(val)||ar.includes(val);
        }); if (matches.length>0){ cy.elements().addClass('faded'); matches.removeClass('faded'); } });
      });
      E.clearBtn && E.clearBtn.addEventListener('click', ()=>{ const cy=App.cy; if (cy && !cy.destroyed()) { cy.elements().remove(); App.graph.showStatus('Graph cleared.'); App.ui.clearHighlights(); }});
      E.saveBtn && E.saveBtn.addEventListener('click', ()=>{ const cy=App.cy; if (!cy || cy.destroyed()||cy.elements().length===0) { App.graph.showStatus('Graph is empty. Cannot save.'); return; } const png=cy.png({ output:'blob', bg:'#f9fafb', full:true, scale:2 }); const url=URL.createObjectURL(png); const a=document.createElement('a'); a.href=url; a.download='graph_export.png'; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); App.graph.showStatus('Graph saved as PNG.'); });
      E.findHubsBtn && E.findHubsBtn.addEventListener('click', ()=>{ const cy=App.cy; if (!cy || cy.destroyed()||cy.elements().length===0){ App.graph.showStatus('Graph is empty. Run a search first.'); return;} const th=parseInt(E.hubThreshold.value)||3; App.ui.clearHighlights(); const hubs=cy.nodes().filter(n=>n.degree()>=th); if (hubs.length>0){ cy.elements().addClass('faded'); hubs.removeClass('faded').addClass('highlighted'); App.graph.showStatus(`Found ${hubs.length} hubs with ${th} or more connections.`);} else { App.graph.showStatus(`No nodes found with ${th} or more connections.`);} });
      // Find Path toggle
      E.findPathBtn && E.findPathBtn.addEventListener('click', ()=>{
        const cy = App.cy; if (!cy || cy.destroyed() || cy.elements().length===0){ App.graph.showStatus('Graph is empty. Run a search first.'); return; }
        App.ui.isFindingPath = !App.ui.isFindingPath;
        if (App.ui.isFindingPath){
          App.ui.clearHighlights();
          App.ui.pathStartNode = null;
          E.findPathBtn.classList.remove('bg-gray-200','text-gray-700','bg-yellow-400','text-black');
          E.findPathBtn.classList.add('bg-sky-500','text-white');
          E.findPathBtn.textContent = 'Cancel Pathfinding';
          App.graph.showStatus('Pathfinding started. Click a start node.');
        } else {
          App.ui.clearHighlights();
          E.findPathBtn.classList.remove('bg-sky-500','text-white');
          E.findPathBtn.classList.add('bg-gray-200','text-gray-700');
          E.findPathBtn.textContent = 'Find Path';
          App.graph.showStatus('Pathfinding cancelled.');
        }
      });
      // Initial search
      this.performSearch();
    },
    buildLegendUI(cfg){
      const cont = this.elements.legendContainer; if (!cont) return; cont.innerHTML = '';
      const def = (cfg && cfg.types && cfg.types.default) || { color:'#ccc', label:'Other' };
      const addRow=(key,label,color)=>{ const row=document.createElement('div'); row.className='flex items-center space-x-2'; row.innerHTML=`<input id="legend-${key}" type="checkbox" class="rounded border-gray-300" checked /><div class="legend-color" style="background-color:${color||'#ccc'}"></div><label for="legend-${key}">${label}</label>`; cont.appendChild(row); };
      addRow('default', (def.label||'Other'), def.color||'#ccc');
      if (cfg && cfg.types){ Object.keys(cfg.types).filter(k=>k!=='default').forEach((code)=>{ const t=cfg.types[code]||{}; addRow(code, t.label||code, t.color||def.color||'#ccc'); }); }
      Array.from(cont.querySelectorAll('input[type="checkbox"]')).forEach(el=> el.addEventListener('change', App.ui.applyLegendFilters));
    },
    applyLegendFilters(){ const cy=App.cy; if (!cy || cy.destroyed()) return; const cont = App.ui.elements.legendContainer; const inputs = cont ? Array.from(cont.querySelectorAll('input[type="checkbox"]')) : []; const active = new Set(inputs.filter(el=>el.checked).map(el=> el.id.replace('legend-',''))); cy.batch(()=>{ cy.nodes().forEach((n)=>{ let key = n.data('ETCode'); if (!App.colors || !App.colors.map[key]) key='default'; if (active.size===0 || !active.has(key)) n.addClass('hidden'); else n.removeClass('hidden'); }); cy.edges().forEach((e)=>{ const sHidden=e.source().hasClass('hidden'); const tHidden=e.target().hasClass('hidden'); if (sHidden || tHidden) e.addClass('hidden'); else e.removeClass('hidden'); }); }); },
    addFilter(){
      const cont = App.ui.elements.filterContainer; if (!cont) return;
      const div = document.createElement('div');
      div.className = 'filter-group p-2 border border-gray-200 rounded-md space-y-2 relative';
      div.innerHTML = `
        <div class="flex space-x-2">
          <input type="text" name="entityType" placeholder="Entity Type" class="w-1/3 p-1.5 border border-gray-300 rounded-md text-sm shadow-sm focus:ring-sky-500 focus:border-sky-500">
          <select name="direction" class="w-1/3 p-1.5 border border-gray-300 rounded-md text-sm shadow-sm focus:ring-sky-500 focus:border-sky-500">
            <option value="both">Both</option>
            <option value="out">Outbound</option>
            <option value="in">Inbound</option>
          </select>
          <select name="match" class="w-1/3 p-1.5 border border-gray-300 rounded-md text-sm shadow-sm" title="Match mode">
            <option value="exact" selected>Exact</option>
            <option value="contains">Contains</option>
          </select>
        </div>
        <input type="text" name="values" placeholder="Values (comma-sep)" class="w-full p-1.5 border border-gray-300 rounded-md text-sm shadow-sm focus:ring-sky-500 focus:border-sky-500">
        <button type="button" class="remove-filter-btn absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold" title="Remove this filter">&times;</button>
      `;
      cont.appendChild(div);
    },
    collectFilters(){ const groups = document.querySelectorAll('.filter-group'); return Array.from(groups).map((g)=>({ entityType: (g.querySelector('input[name="entityType"]').value||'').trim(), values: (g.querySelector('input[name="values"]').value||'').split(',').map(s=>s.trim()).filter(Boolean), direction: g.querySelector('select[name="direction"]').value, match: (g.querySelector('select[name="match"]').value||'exact') })).filter(f=> f.entityType && f.values.length>0); },
    performSearch(){ const filters=this.collectFilters(); const depth=App.globalDepth||2; const lang=(this.elements.languageSelect && this.elements.languageSelect.value)||'EN'; if (filters.length===0){ App.graph.showStatus('Please add at least one valid filter (Entity Type and Value).'); return; } App.api.getGraphForFilters(filters, depth).then((data)=>{ if (!data || data.nodes.length===0){ App.graph.showStatus('No matches found. Loading full dataset.'); App.graph.initOrUpdate(App.baseData, lang, false); } else { App.graph.initOrUpdate(data, lang, false); } }); },
    clearHighlights(){ const cy=App.cy; if (cy && !cy.destroyed()){ cy.batch(()=>{ cy.elements().removeClass('faded highlighted'); cy.nodes().removeClass('path-start path-end path-node'); cy.edges().removeClass('path-edge'); }); } },
    takeExpansionBatch(nodeId, elements, cap){ const batch=[]; const rest=[]; for (let i=0;i<elements.length;i++){ (i<cap?batch:rest).push(elements[i]); } if (rest.length>0){ const ex=pendingExpansions.get(nodeId)||{nodes:[],edges:[]}; ex.nodes.push(...rest.filter(e=>e.group==='nodes')); ex.edges.push(...rest.filter(e=>e.group==='edges')); pendingExpansions.set(nodeId, ex);} return batch; },
    async handleNodeExpansion(el){ if (!el || el.length===0) return; const nodeData=el.data(); App.graph.showStatus(`Checking neighbors for node ${nodeData.ID}...`); const lang=this.elements.languageSelect.value; const full = await App.api.getExpansionForNode(nodeData.id, App.globalDepth||2); const elementsToAdd=[]; full.nodes.forEach((n)=>{ if (!App.cy.getElementById(n.data.id).length) elementsToAdd.push(n); }); full.edges.forEach((e)=>{ if (!App.cy.getElementById(e.data.id).length) elementsToAdd.push(e); }); if (elementsToAdd.length===0){ App.graph.showStatus(`Node ${nodeData.ID} has no new, unexpanded neighbors.`); this.clearHighlights(); el.addClass('highlighted'); setTimeout(()=> el.removeClass('highlighted'), 1500); return; } const cap = (App.config && (App.config.batchSize ?? 200)) || 200; const capped = this.takeExpansionBatch(nodeData.id, elementsToAdd, cap); const newData = { nodes: capped.filter(e=>e.group==='nodes'), edges: capped.filter(e=>e.group==='edges') }; App.graph.initOrUpdate(newData, lang, true, el); },
    setupEventListeners(){ const cy=App.cy; if (!cy || cy.destroyed()) return; cy.off('tap','node'); cy.on('tap','node',(evt)=>{ const clicked=evt.target;
      // Pathfinding mode
      if (App.ui.isFindingPath){
        if (!App.ui.pathStartNode){
          App.ui.clearHighlights();
          App.ui.pathStartNode = clicked;
          clicked.addClass('path-start');
          App.graph.showStatus(`Start node set to '${clicked.data('ID')}'. Click an end node.`);
        } else {
          const endNode = clicked;
          if (App.ui.pathStartNode.id() === endNode.id()) { App.graph.showStatus('Start and end nodes cannot be the same.'); return; }
          endNode.addClass('path-end');
          const aStar = cy.elements().aStar({ root: App.ui.pathStartNode, goal: endNode, directed: false });
          if (aStar.found){
            cy.batch(()=>{ aStar.path.nodes().addClass('path-node'); aStar.path.edges().addClass('path-edge'); App.ui.pathStartNode.addClass('path-start'); endNode.addClass('path-end'); });
            App.graph.showStatus(`Path found! Length: ${aStar.distance}.`);
          } else {
            App.graph.showStatus(`No path found between '${App.ui.pathStartNode.data('ID')}' and '${endNode.data('ID')}'.`);
          }
          // reset
          App.ui.isFindingPath = false; App.ui.pathStartNode = null;
          const btn = App.ui.elements.findPathBtn; if (btn){ btn.classList.remove('bg-sky-500','text-white'); btn.classList.add('bg-gray-200','text-gray-700'); btn.textContent='Find Path'; }
        }
        return;
      }
      // Expansion mode (default)
      App.ui.handleNodeExpansion(clicked);
      const nb = clicked.neighborhood();
      cy.batch(()=>{ cy.elements().addClass('faded'); clicked.removeClass('faded'); nb.removeClass('faded'); });
      // Populate details panel
      const nodeData = clicked.data();
      const language = (App.ui.elements.languageSelect && App.ui.elements.languageSelect.value) || 'EN';
      if (App.ui.elements.detailsContent){
        const html = `
          <div><strong>ID:</strong> ${nodeData.ID || 'N/A'}</div>
          <div><strong>Type:</strong> ${nodeData.ETEn || 'N/A'} (${nodeData.ETCode || 'N/A'})</div>
          <div><strong>Label (${language}):</strong> ${nodeData[language] || nodeData.ID || 'N/A'}</div>
          <div><strong>Degree:</strong> ${clicked.degree() || 0}</div>
          <hr class="my-2 border-gray-200">
          <h4 class="font-semibold text-gray-700 text-sm mb-1">Raw Properties:</h4>
          <pre class="text-xs bg-gray-50 p-2 rounded-md overflow-auto">${JSON.stringify(nodeData, null, 2)}</pre>
        `;
        App.ui.elements.detailsContent.innerHTML = html;
      }
    });
    // Edge click -> show edge details
    cy.off('tap','edge');
    cy.on('tap','edge',(evt)=>{
      const cy = App.cy; if (!cy || cy.destroyed()) return;
      if (App.ui.isFindingPath) return; // ignore edge clicks during path selection
      const edge = evt.target;
      const src = edge.source();
      const tgt = edge.target();
      const language = (App.ui.elements.languageSelect && App.ui.elements.languageSelect.value) || 'EN';
      // Highlight edge and endpoints
      cy.batch(()=>{
        cy.elements().addClass('faded');
        edge.removeClass('faded'); src.removeClass('faded'); tgt.removeClass('faded');
      });
      // Details panel
      const eData = edge.data();
      const detailsEl = App.ui.elements.detailsContent;
      if (detailsEl){
        const label = (language==='EN') ? (eData.nameEn || eData.EN || 'N/A') : (eData.nameAr || eData.AR || 'N/A');
        const html = `
          <div><strong>Edge ID:</strong> ${eData.id || 'N/A'}</div>
          <div><strong>Label (${language}):</strong> ${label}</div>
          <div><strong>RTCode:</strong> ${eData.RTCode || 'N/A'}</div>
          <div><strong>Source:</strong> ${(src.data('ID') || src.id())} (${src.data('ETCode') || 'N/A'})</div>
          <div><strong>Target:</strong> ${(tgt.data('ID') || tgt.id())} (${tgt.data('ETCode') || 'N/A'})</div>
          <hr class="my-2 border-gray-200">
          <h4 class="font-semibold text-gray-700 text-sm mb-1">Raw Edge:</h4>
          <pre class="text-xs bg-gray-50 p-2 rounded-md overflow-auto">${JSON.stringify(eData, null, 2)}</pre>
        `;
        detailsEl.innerHTML = html;
      }
    });
      // Context menu (requires extension loaded)
      if (cy && typeof cy.cxtmenu === 'function'){
        const menuOptions = { menuRadius:80, selector:'node', fillColor:'rgba(0,0,0,0.75)', activeFillColor:'rgba(14,165,233,0.75)', itemColor:'white', fetch:(ele)=>{
          const nodeId = ele.data('id'); const hasPending = pendingExpansions.has(nodeId);
          const items=[ { content:'<span style="font-size:10px;color:#cbd5e1;">Node Actions</span>', enabled:false }, { content:'Expand', select:(el)=> App.ui.handleNodeExpansion(el) }, hasPending ? { content:'Load More Neighbors', select:()=>{ const pending=pendingExpansions.get(nodeId); if (!pending) return; const toTake=(App.config && (App.config.batchSize ?? 200))||200; const next=[]; while (next.length<toTake && (pending.nodes.length||pending.edges.length)){ if (pending.nodes.length) next.push(pending.nodes.shift()); if (next.length>=toTake) break; if (pending.edges.length) next.push(pending.edges.shift()); } if (pending.nodes.length===0 && pending.edges.length===0) pendingExpansions.delete(nodeId); else pendingExpansions.set(nodeId, pending); App.graph.initOrUpdate({ nodes: next.filter(e=>e.group==='nodes'), edges: next.filter(e=>e.group==='edges') }, App.ui.elements.languageSelect.value, true, ele); App.graph.showStatus('Loaded more neighbors.'); } } : null ]; return Promise.resolve(items.filter(Boolean)); } };
        if (cy.cxtmenuApi) cy.cxtmenuApi.destroy(); cy.cxtmenuApi = cy.cxtmenu(menuOptions);
      }
    }
  };
})();
