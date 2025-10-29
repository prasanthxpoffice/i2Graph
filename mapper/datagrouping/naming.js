(() => {
  const statusEl = document.getElementById('status');
  const metaEl = document.getElementById('meta');
  const spinner = document.getElementById('llmSpinner');
  const missingEl = document.getElementById('missing');
  const namingEl = document.getElementById('naming');
  const saveBtn = document.getElementById('saveNamesBtn');

  function setStatus(t){ statusEl.textContent = t || ''; }
  function setMeta(t){ metaEl.textContent = t || ''; }
  function setLoading(b){ spinner.style.display = b ? '' : 'none'; saveBtn.disabled = !!b; }

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
        'Goal: propose a short, human-friendly name for each group, based on the semantic meaning of its EN/AR columns and ID pattern.',
        'Rules:',
        '- Prefer concise nouns like "City", "Employee", "Department".',
        '- If EN indicates a base like cityname or nameen/namear, infer the base (e.g., City).',
        '- Fall back to TitleCase of the EN header when unsure.',
        'Output: { "names": [ { "index": number, "name": string } ] } where index matches the group index provided.'
      ].join('\n');
      const user = JSON.stringify({ headers, groups, samples: sampleRows.slice(0, 20) });
      try {
        const resp = await fetch(apiBase + '/chat/completions', {
          method: 'POST', headers: { 'Content-Type':'application/json' },
          body: JSON.stringify({ messages: [ {role:'system', content: sys}, {role:'user', content: user} ], temperature: 0.2 })
        });
        const raw = await resp.text();
        let data; try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
        const text = data?.choices?.[0]?.message?.content || '';
        let json = {}; try { json = JSON.parse((text.match(/\{[\s\S]*\}/) || [])[0] || '{}'); } catch {}
        const names = Array.isArray(json.names) ? json.names : [];
        return names;
      } catch (e) {
        return [];
      }
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
      const label = document.createElement('label'); label.textContent = 'Name';
      const input = document.createElement('input'); input.type='text'; input.className='nameInput'; input.value = (names.find(n => n.index === i)?.name) || titleCase(g.en || g.ar || g.id || `Group ${i+1}`);
      input.setAttribute('data-index', String(i));
      row.appendChild(label); row.appendChild(input);
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
    render(groups, names || []);
  }

  saveBtn.addEventListener('click', () => {
    try {
      const inputs = Array.from(namingEl.querySelectorAll('input.nameInput'));
      const names = inputs.map(inp => ({ index: Number(inp.getAttribute('data-index')||'0'), name: String(inp.value||'').trim() }));
      sessionStorage.setItem('groupNames', JSON.stringify(names));
      setStatus('Saved group names.');
    } catch (e) {
      setStatus('Failed to save names.');
    }
  });

  init();
})();

