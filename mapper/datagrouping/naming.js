(() => {
  const statusEl = document.getElementById('status');
  const metaEl = document.getElementById('meta');
  // Using global spinner via window.Activity; no page-local spinner
  const missingEl = document.getElementById('missing');
  const namingEl = document.getElementById('naming');
  const saveBtn = document.getElementById('saveNamesBtn');

  function setStatus(t){ statusEl.textContent = t || ''; }
  function setMeta(t){ metaEl.textContent = t || ''; }
  function setLoading(b){ saveBtn.disabled = !!b; }

  function loadGroups(){
    try { return JSON.parse(sessionStorage.getItem('groupingDefinition') || '[]'); } catch { return []; }
  }
  function loadCsv(){ return sessionStorage.getItem('uploadedCsvText') || ''; }

  async function suggestNames(headers, groups, sampleRows){
    try {
      if (!window.LLM || !window.LLM.getProvider) throw new Error('LLM missing');
      const provider = window.LLM.getProvider();
      if (!provider || !provider._postChat) throw new Error('LLM provider not ready');
    } catch (e) {}

    // Use the shared proxy endpoint via LLM helper if available; otherwise custom call
    if (window.LLM && window.LLM.getProvider) {
      const cfg = await window.LLM.init();
      const apiBase = (cfg.apiBase || '/api').replace(/\/$/, '');
      const sys = [
        'You are a naming assistant.',
        'Given CSV headers and an array of groups (each with id, en, ar, idStrategy), return STRICT JSON ONLY (no prose).',
        'Goal: propose short, human-friendly bilingual names for each group, in English (en) and Arabic (ar), based on EN/AR columns and ID pattern.',
        'Rules:',
        '- Prefer concise nouns like "City", "Employee", "Department".',
        '- If EN indicates a base like cityname or nameen/namear, infer the base (e.g., City).',
        '- Fall back to TitleCase of the EN header when unsure.',
        '- Always include both fields: en and ar. If unsure for Arabic, provide a reasonable Arabic equivalent of the concept.',
        'Output JSON shape exactly: { "names": [ { "index": number, "en": string, "ar": string } ] } where index matches the group index provided.'
      ].join('\n');
      const user = JSON.stringify({ headers, groups, samples: sampleRows.slice(0, 20) });
      try {
        try { window.Activity && window.Activity.start(); } catch(_) {}
        const resp = await fetch(apiBase + '/chat/completions', {
          method: 'POST', headers: { 'Content-Type':'application/json' },
          body: JSON.stringify({ messages: [ {role:'system', content: sys}, {role:'user', content: user} ], temperature: 0.2 })
        });
        const raw = await resp.text();
        let data; try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
        const text = data?.choices?.[0]?.message?.content || '';
        let json = {}; try { json = JSON.parse((text.match(/\{[\s\S]*\}/) || [])[0] || '{}'); } catch {}
        const names = Array.isArray(json.names) ? json.names : [];
        return names.map(n => ({ index: Number(n.index), en: String(n.en || n.name || ''), ar: String(n.ar || '') }));
      } catch (e) {
        return [];
      } finally { try { window.Activity && window.Activity.end(); } catch(_) {} }
    }
    return [];
  }

  function titleCase(s){ return String(s||'').replace(/[\W_]+/g,' ').trim().replace(/\s+([a-z])/g,(m,c)=>' '+c.toUpperCase()).replace(/^([a-z])/,(m,c)=>c.toUpperCase()); }

  function render(groups, names){
    namingEl.innerHTML = '';
    groups.forEach((g, i) => {
      const card = document.createElement('div'); card.className = 'groupCard';
      const title = document.createElement('div'); title.className = 'groupTitle'; title.textContent = `Group ${i+1}`; card.appendChild(title);
      const row = document.createElement('div'); row.className = 'row';
      const labelEn = document.createElement('label'); labelEn.textContent = 'English';
      const inputEn = document.createElement('input'); inputEn.type='text'; inputEn.className='nameInput';
      inputEn.value = (names.find(n => n.index === i)?.en) || titleCase(g.en || g.ar || g.id || `Group ${i+1}`);
      inputEn.setAttribute('data-index', String(i)); inputEn.setAttribute('data-lang','en');
      const labelAr = document.createElement('label'); labelAr.textContent = 'Arabic';
      const inputAr = document.createElement('input'); inputAr.type='text'; inputAr.className='nameInput';
      inputAr.value = (names.find(n => n.index === i)?.ar) || '';
      inputAr.setAttribute('data-index', String(i)); inputAr.setAttribute('data-lang','ar');
      row.appendChild(labelEn); row.appendChild(inputEn); row.appendChild(labelAr); row.appendChild(inputAr);
      const meta = document.createElement('div'); meta.className='hint'; meta.textContent = `ID: ${g.id ?? '(hash)'} · EN: ${g.en} · AR: ${g.ar}`;
      card.appendChild(row); card.appendChild(meta);
      namingEl.appendChild(card);
    });
  }

  async function init(){
    const groups = loadGroups();
    if (!groups.length){ missingEl.style.display=''; setStatus(''); setMeta(''); return; }
    setMeta(`${groups.length} group(s) to name`);
    const csv = loadCsv();
    // simple sampling: parse first 10 lines for illustrative context if needed later
    const headers = []; const samples = [];
    try {
      const head = csv.split(/\r?\n/)[0] || '';
      head.split(',').forEach(h => headers.push(String(h||'').trim()));
    } catch {}
    setLoading(true);
    const names = await suggestNames(headers, groups, samples);
    setLoading(false);
    setStatus(names.length ? 'LLM suggested names. Review and edit.' : 'No name suggestions from LLM. Provide names manually.');
    namingEl.style.display='';
    renderTable(groups, names || []);
  }

  function renderTable(groups, names){
    namingEl.innerHTML = '';
    const table = document.createElement('table');
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';
    table.style.fontSize = '14px';
    const thead = document.createElement('thead');
    const thr = document.createElement('tr');
    ['ID', 'EN', 'AR', 'Group Name EN', 'Group Name AR'].forEach(h => {
      const th = document.createElement('th');
      th.textContent = h;
      th.style.textAlign = 'left';
      th.style.borderBottom = '1px solid #ddd';
      th.style.padding = '6px 8px';
      thr.appendChild(th);
    });
    thead.appendChild(thr);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    groups.forEach((g, i) => {
      const tr = document.createElement('tr');
      const tdId = document.createElement('td'); tdId.textContent = g.id ? g.id : '(hash EN+AR)';
      const tdEn = document.createElement('td'); tdEn.textContent = g.en || '';
      const tdAr = document.createElement('td'); tdAr.textContent = g.ar || '';
      [tdId, tdEn, tdAr].forEach(td => { td.style.padding = '6px 8px'; td.style.borderBottom = '1px solid #f0f0f0'; });
      const tdNameEn = document.createElement('td'); tdNameEn.style.padding='6px 8px'; tdNameEn.style.borderBottom='1px solid #f0f0f0';
      const inputEn = document.createElement('input'); inputEn.type='text'; inputEn.className='nameInput'; inputEn.style.minWidth='200px';
      inputEn.value = (names.find(n => n.index === i)?.en) || titleCase(g.en || g.ar || g.id || `Group ${i+1}`);
      inputEn.setAttribute('data-index', String(i)); inputEn.setAttribute('data-lang','en');
      tdNameEn.appendChild(inputEn);
      const tdNameAr = document.createElement('td'); tdNameAr.style.padding='6px 8px'; tdNameAr.style.borderBottom='1px solid #f0f0f0';
      const inputAr = document.createElement('input'); inputAr.type='text'; inputAr.className='nameInput'; inputAr.style.minWidth='200px';
      inputAr.value = (names.find(n => n.index === i)?.ar) || '';
      inputAr.setAttribute('data-index', String(i)); inputAr.setAttribute('data-lang','ar');
      tdNameAr.appendChild(inputAr);
      tr.appendChild(tdId); tr.appendChild(tdEn); tr.appendChild(tdAr); tr.appendChild(tdNameEn); tr.appendChild(tdNameAr);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    namingEl.appendChild(table);
  }

  saveBtn.addEventListener('click', () => {
    try {
      const inputs = Array.from(namingEl.querySelectorAll('input.nameInput'));
      const byIndex = new Map();
      inputs.forEach(inp => {
        const idx = Number(inp.getAttribute('data-index')||'0');
        const lang = inp.getAttribute('data-lang') || 'en';
        const val = String(inp.value||'').trim();
        if (!byIndex.has(idx)) byIndex.set(idx, { index: idx, en: '', ar: '' });
        byIndex.get(idx)[lang] = val;
      });
      const names = Array.from(byIndex.values());
      sessionStorage.setItem('groupNames', JSON.stringify(names));
      setStatus('Saved group names. Moving to nodes…');
      // navigate to nodes selection step
      const target = encodeURIComponent('mapper/datagrouping/nodes.html');
      const inMaster = !!document.querySelector('.layout') || !!document.getElementById('content');
      if (inMaster) window.location.hash = '#/' + target; else window.location.href = '/Index.html#/' + target;
    } catch (e) {
      setStatus('Failed to save names.');
    }
  });

  init();
})();
