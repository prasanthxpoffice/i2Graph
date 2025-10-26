// Graph rendering and layout
(function(){
  window.App = window.App || {};

  App.graph = {
    currentLayout: null,
    showStatus(msg){
      const el = document.getElementById('status-message');
      if (!el) return;
      el.textContent = msg;
      el.classList.remove('opacity-0');
      setTimeout(()=> el.classList.add('opacity-0'), 3000);
    },
    runLayout(name){
      const cy = App.cy; if (!cy) return;
      if (App.graph.currentLayout) App.graph.currentLayout.stop();
      try {
        const animate = (App.useAnimate && typeof App.useAnimate==='function') ? (App.useAnimate() ? 'end' : false) : false;
        const duration = (App.useAnimate && typeof App.useAnimate==='function') ? (App.useAnimate() ? 800 : 0) : 0;
        const layout = cy.layout({ name, animate, animationDuration: duration, fit: true, padding: 50, rankDir: 'TB', spacingFactor:1.2, idealEdgeLength:100, nodeRepulsion:2000 });
        App.graph.currentLayout = layout; layout.run();
        App.graph.showStatus(`Applied ${name} layout.`);
      } catch(e){ console.error(e); App.graph.showStatus(`Error: ${name} layout not available.`); }
    },
    initOrUpdate(graphData, language, isUpdate=false, expandNode=null){
      const cyContainer = document.getElementById('cy');
      const cy = App.cy;
      const nodeLabelStyle = `data(${language})`;
      const edgeLabelStyle = `data(${language === 'EN' ? 'nameEn' : 'nameAr'})`;
      const elements = [
        ...graphData.nodes.map(n=>({ ...n, data: { ...n.data, degree:0 } })),
        ...graphData.edges,
      ];
      const degreeMap = new Map();
      graphData.edges.forEach((e)=>{
        degreeMap.set(e.data.source,(degreeMap.get(e.data.source)||0)+1);
        degreeMap.set(e.data.target,(degreeMap.get(e.data.target)||0)+1);
      });
      elements.forEach((el)=>{ if (el.group==='nodes' && degreeMap.has(el.data.id)) el.data.degree = degreeMap.get(el.data.id); });

      const style=[
        { selector:'node', style:{ 'background-color':'data(color)','border-color':'data(borderColor)','border-width':2, width:'mapData(degree, 0, 10, 30, 60)', height:'mapData(degree, 0, 10, 30, 60)', label: nodeLabelStyle, 'font-size':'10px','min-zoomed-font-size':6,color:'#333','text-valign':'bottom','text-halign':'center','text-margin-y':5,'text-wrap':'wrap','text-max-width':'80px','transition-property':'opacity, background-color, border-color','transition-duration':'0.2s' } },
        { selector:'edge', style:{ width:2,'line-color':'#cbd5e1', label: edgeLabelStyle,'font-size':'8px','min-zoomed-font-size':7,color:'#64748b','text-background-color':'#f9fafb','text-background-opacity':0.7,'text-background-padding':2,'text-background-shape':'round-rectangle','curve-style':'bezier','target-arrow-shape':'triangle','target-arrow-color':'#cbd5e1','transition-property':'opacity, line-color, target-arrow-color','transition-duration':'0.2s' } },
        { selector:'.hidden', style:{ display:'none' } },
        { selector:'.faded', style:{ opacity:0.25 } },
        { selector:'.highlighted', style:{ 'background-color':'#0ea5e9','border-color':'#0284c7','border-width':2, 'z-index':99 } },
        { selector:'.path-start', style:{ 'background-color':'#10b981','border-color':'#059669','border-width':3, shape:'star' } },
        { selector:'.path-end', style:{ 'background-color':'#ef4444','border-color':'#dc2626','border-width':3, shape:'diamond' } },
        { selector:'.path-node', style:{ 'background-color':'#f59e0b','border-color':'#d97706','border-width':2 } },
        { selector:'.path-edge', style:{ 'line-color':'#f59e0b','target-arrow-color':'#f59e0b', width:4,'z-index':100 } },
      ];

      if (isUpdate && cy && !cy.destroyed()){
        let added;
        cy.batch(()=>{ added = cy.add(elements); cy.elements().removeClass('faded highlighted path-node path-start path-end path-edge'); });
        (function(){ const ls=document.getElementById('layout-select'); App.graph.runLayout((ls && ls.value) || 'cose'); })();
        App.graph.showStatus(`Expanded. Added ${added.filter('node').length} nodes, ${added.filter('edge').length} edges.`);
        return;
      }

      if (cy && !cy.destroyed()) cy.destroy();
      // Determine initial layout + animation from UI controls
      const layoutSelect = document.getElementById('layout-select');
      const initialLayoutName = (layoutSelect && layoutSelect.value) || 'cose';
      const initialAnimate = (App.useAnimate && typeof App.useAnimate==='function') ? (App.useAnimate() ? 'end' : false) : false;
      const initialDuration = (App.useAnimate && typeof App.useAnimate==='function') ? (App.useAnimate() ? 800 : 0) : 0;

      App.cy = cytoscape({
        container: cyContainer,
        elements,
        style,
        layout: { name: initialLayoutName, animate: initialAnimate, animationDuration: initialDuration, fit: true, padding: 50 },
        wheelSensitivity: 0.2,
      });
      App.graph.currentLayout = App.cy.layout({ name: initialLayoutName, animate: initialAnimate, animationDuration: initialDuration, fit: true, padding: 50 });
      App.cy.ready(()=>{ App.ui.applyLegendFilters(); App.graph.showStatus(`Graph loaded with ${App.cy.nodes().length} nodes and ${App.cy.edges().length} edges.`); });
      App.ui.setupEventListeners();
    }
  };
})();
