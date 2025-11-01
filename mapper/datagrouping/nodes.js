(() => {
  const statusEl = document.getElementById('status');
  const metaEl = document.getElementById('meta');
  // Using global spinner via window.Activity; no page-local spinner
  const nodesEl = document.getElementById('nodes');
  const saveBtn = document.getElementById('saveNodesBtn');
  const prevBtn = document.getElementById('prevToNamingBtn');
  let allGroups = [];
  let nameMapCache = new Map();

  function setStatus(t){ statusEl.textContent = t || ''; }
  function setMeta(t){ metaEl.textContent = t || ''; }
  function setLoading(b){ saveBtn.disabled = !!b; }

  function loadGroups(){ try { return JSON.parse(sessionStorage.getItem('groupingDefinition')||'[]'); } catch { return []; } }
  function loadGroupNames(){ try { return JSON.parse(sessionStorage.getItem('groupNames')||'[]'); } catch { return []; } }
  function loadSavedNodes(){ try { return JSON.parse(sessionStorage.getItem('nodesDefinition')||'[]'); } catch { return []; } }

  function namesByIndex(){ const map = new Map(); (loadGroupNames()||[]).forEach(n=>map.set(n.index, n)); return map; }

  async function suggestNodes(groups, names){
    // Ask LLM which groups are likely to be Nodes and propose labels
    try {
      if (!window.LLM || !window.LLM.getProvider) throw new Error('LLM missing');
    } catch (e) { return []; }
    try {
      const cfg = await window.LLM.init();
      const apiBase = (cfg.apiBase || '/api').replace(/\/$/, '');
      const sys = [
        'You are assisting with Neo4j data modeling.',
        'Input is a list of groups with bilingual names and their column roles (id/en/ar).',
        'Task: decide which groups should be represented as Node labels in a Neo4j graph and propose concise bilingual labels for them.',
        'Output strictly JSON: { "nodes": [ { "index": number, "isNode": boolean, "en": string, "ar": string } ] }'
      ].join('\n');
      const user = JSON.stringify({ groups, names });
      setLoading(true);
      try { window.Activity && window.Activity.start(); } catch(_) {}
      const resp = await fetch(apiBase + '/chat/completions', {
        method: 'POST', headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ messages: [ {role:'system', content: sys}, {role:'user', content: user} ], temperature: 0.1 })
      });
      const raw = await resp.text();
      let data; try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
      const text = data?.choices?.[0]?.message?.content || '';
      let json = {}; try { json = JSON.parse((text.match(/\{[\s\S]*\}/) || [])[0] || '{}'); } catch {}
      const nodes = Array.isArray(json.nodes) ? json.nodes : [];
      return nodes.map(n => ({ index: Number(n.index), isNode: !!n.isNode, en: String(n.en||''), ar: String(n.ar||'') }));
    } catch(e) { return []; }
    finally { setLoading(false); try { window.Activity && window.Activity.end(); } catch(_) {} }
  }

  function renderTable(groups, initial){
    nodesEl.innerHTML = '';
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const thr = document.createElement('tr');
    ['ID','EN','AR','Group Name EN','Group Name AR','Is Node?'].forEach(h=>{
      const th=document.createElement('th'); th.textContent=h; th.style.padding='6px 8px'; th.style.borderBottom='1px solid #ddd'; thr.appendChild(th);
    });
    thead.appendChild(thr); table.appendChild(thead);
    const tbody = document.createElement('tbody');
    const nameMap = namesByIndex();
    groups.forEach((g, i) => {
      const tr = document.createElement('tr');
      const pref = initial.find(x=>x.index===i) || {};
      const tdId=document.createElement('td'); tdId.textContent=g.id?g.id:'(hash EN+AR)';
      const nm = nameMap.get(i);
      const tdEn=document.createElement('td'); tdEn.textContent=g.en||'';
      const tdAr=document.createElement('td'); tdAr.textContent=g.ar||'';
      const tdGEn=document.createElement('td'); tdGEn.textContent=(nm?.en)||g.en||'';
      const tdGAr=document.createElement('td'); tdGAr.textContent=(nm?.ar)||g.ar||'';
      [tdId,tdEn,tdAr,tdGEn,tdGAr].forEach(td=>{ td.style.padding='6px 8px'; td.style.borderBottom='1px solid #f0f0f0'; });
      const tdChk=document.createElement('td'); tdChk.style.padding='6px 8px'; tdChk.style.borderBottom='1px solid #f0f0f0';
      const chk=document.createElement('input'); chk.type='checkbox'; chk.className='isNodeChk'; chk.checked = pref.isNode ?? true; chk.setAttribute('data-index', String(i)); tdChk.appendChild(chk);
      [tdChk].forEach(td=>{ td.style.verticalAlign='middle'; });
      tr.appendChild(tdId); tr.appendChild(tdEn); tr.appendChild(tdAr); tr.appendChild(tdGEn); tr.appendChild(tdGAr); tr.appendChild(tdChk);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody); nodesEl.appendChild(table);
  }

  async function init(){
    const groups = loadGroups();
    const names = loadGroupNames();
    allGroups = groups;
    nameMapCache = new Map(); (names||[]).forEach(n=>nameMapCache.set(n.index, n));
    if (!groups.length){ setStatus('No groups found. Go back and confirm groups first.'); return; }
    setMeta(`${groups.length} group(s)`);
    const saved = loadSavedNodes();
    const done = sessionStorage.getItem('llm_nodes_done') === '1';
    if (done && Array.isArray(saved) && saved.length){
      setStatus('Using previously saved node selections.');
      renderTable(groups, saved);
    } else {
      const suggestions = await suggestNodes(groups, names);
      setStatus(suggestions.length ? 'LLM suggested nodes. Review and edit.' : 'Select which groups are nodes.');
      renderTable(groups, suggestions);
      try { sessionStorage.setItem('llm_nodes_done', '1'); } catch {}
    }
  }

  saveBtn.addEventListener('click', () => {
    try {
      const rows = Array.from(nodesEl.querySelectorAll('tr'));
      const result = [];
      rows.forEach((tr, idx) => {
        if (idx === 0) return; // header
        const i = idx-1;
        const chk = tr.querySelector('input.isNodeChk');
        const nm = nameMapCache.get(i);
        const en = (nm?.en || allGroups[i]?.en || '').trim();
        const ar = (nm?.ar || allGroups[i]?.ar || '').trim();
        result.push({ index: i, isNode: !!(chk && chk.checked), en, ar });
      });
      sessionStorage.setItem('nodesDefinition', JSON.stringify(result));
      setStatus('Saved nodes. Moving to relationships…');
      const target = encodeURIComponent('mapper/datagrouping/relationships.html');
      const inMaster = !!document.querySelector('.layout') || !!document.getElementById('content');
      if (inMaster) window.location.hash = '#/' + target; else window.location.href = '/Index.html#/' + target;
    } catch (e) {
      setStatus('Failed to save nodes.');
    }
  });

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      try {
        const target = encodeURIComponent('mapper/datagrouping/naming.html');
        const inMaster = !!document.querySelector('.layout') || !!document.getElementById('content');
        if (inMaster) window.location.hash = '#/' + target; else window.location.href = '/Index.html#/' + target;
      } catch (e) { /* noop */ }
    });
  }

  init();
})();

