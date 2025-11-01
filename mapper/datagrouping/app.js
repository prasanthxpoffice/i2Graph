(() => {
  const metaEl = document.getElementById('meta');
  const statusEl = document.getElementById('status');
  const reuploadSec = document.getElementById('reupload');
  const reuploadInput = document.getElementById('reuploadInput');
  const groupControls = document.getElementById('groupControls');
  const addGroupBtn = document.getElementById('addGroupBtn');
  const confirmBtn = document.getElementById('confirmBtn');
  const groupList = document.getElementById('groupList');
  const ungroupedMsg = document.getElementById('ungroupedMsg');
  // Removed page-local spinner; relying on global Activity spinner
  const llmBadge = document.getElementById('llmBadge');

  let headers = [];
  let rows = [];
  const loadSavedGroups = () => { try { return JSON.parse(sessionStorage.getItem('groupingDefinition')||'[]'); } catch { return []; } };

  function setStatus(msg) { statusEl.textContent = msg || ''; }
  function setMeta(msg) { metaEl.textContent = msg || ''; }

  function setLoading(loading) {
    try {
      if (addGroupBtn) addGroupBtn.disabled = !!loading;
      if (confirmBtn) confirmBtn.disabled = !!loading;
      if (loading) {
        statusEl.textContent = 'Suggesting groups from headers…';
      }
      // spinner handled globally by window.Activity
    } catch (e) { /* noop */ }
  }

  async function checkLlmHealth() {
    try {
      if (!window.LLM || !window.LLM.init) {
        if (llmBadge) { llmBadge.className='err'; llmBadge.textContent='LLM not loaded'; }
        return;
      }
      const cfg = await window.LLM.init();
      const base = (cfg && cfg.apiBase) ? String(cfg.apiBase).replace(/\/$/, '') : '/api';
      const res = await fetch(base + '/health', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const h = await res.json();
      if (llmBadge) { llmBadge.className='ok'; llmBadge.textContent = h && h.ok ? ('LLM OK' + (h.model ? (' · ' + h.model) : '')) : 'LLM Unknown'; }
    } catch (e) {
      if (llmBadge) { llmBadge.className='err'; llmBadge.textContent='LLM Offline'; }
    }
  }

  // Removed preview table rendering (legacy Apply Grouping UI)

  function distinct(arr) { return Array.from(new Set(arr)); }
  function createOption(value, selected, disabled) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value;
    if (selected) opt.selected = true;
    if (disabled) opt.disabled = true;
    return opt;
  }

  function buildGroupRow(initial) {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '8px';
    row.style.alignItems = 'center';

    const idWrap = document.createElement('label'); idWrap.className = 'pill'; idWrap.textContent = ' ID ';
    const idSel = document.createElement('select'); idSel.style.minWidth = '140px';
    idWrap.appendChild(idSel);

    const enWrap = document.createElement('label'); enWrap.className = 'pill'; enWrap.textContent = ' EN ';
    const enSel = document.createElement('select'); enSel.style.minWidth = '140px'; enWrap.appendChild(enSel);

    const arWrap = document.createElement('label'); arWrap.className = 'pill'; arWrap.textContent = ' AR ';
    const arSel = document.createElement('select'); arSel.style.minWidth = '140px'; arWrap.appendChild(arSel);

    const removeBtn = document.createElement('button'); removeBtn.className = 'pill'; removeBtn.textContent = 'Remove';

    row.appendChild(idWrap); row.appendChild(enWrap); row.appendChild(arWrap); row.appendChild(removeBtn);

    function refreshOptions() {
      const used = collectUsedSelections(row);
      const all = headers.slice();
      const selects = [idSel, enSel, arSel];
      selects.forEach((sel, idx) => {
        const current = sel.value;
        sel.innerHTML = '';
        const placeholder = document.createElement('option'); placeholder.value=''; placeholder.textContent='-- Select --'; sel.appendChild(placeholder);
        all.forEach(h => {
          const disallow = used.has(h) && used.get(h) !== sel; // used by other select in other rows
          sel.appendChild(createOption(h, h === current, disallow));
        });
      });
      // No hash logic: ID is always a column and required
      idSel.disabled = false;
    }

    [idSel, enSel, arSel].forEach(s => s.addEventListener('change', () => { refreshOptions(); updateAllOptionLocks(); }));
    removeBtn.addEventListener('click', () => { row.remove(); updateAllOptionLocks(); });

    row.getValue = () => ({ id: idSel.value || null, en: enSel.value || null, ar: arSel.value || null, idStrategy: 'column' });
    row.setValue = (g) => {
      if (g?.id) idSel.value = g.id;
      if (g?.en) enSel.value = g.en;
      if (g?.ar) arSel.value = g.ar;
      refreshOptions();
      updateAllOptionLocks();
    };

    // initial populate
    refreshOptions();
    if (initial) row.setValue(initial);
    return row;
  }

  function collectUsedSelections(excludeRow) {
    const map = new Map();
    Array.from(groupList.children).forEach(r => {
      if (r === excludeRow) return;
      const selects = r.querySelectorAll('select');
      selects.forEach(sel => { if (sel.value) map.set(sel.value, sel); });
    });
    return map;
  }

  function updateAllOptionLocks() {
    Array.from(groupList.children).forEach(r => {
      const used = collectUsedSelections(r);
      const selects = r.querySelectorAll('select');
      selects.forEach(sel => {
        const current = sel.value;
        sel.querySelectorAll('option').forEach(opt => {
          if (!opt.value) return;
          opt.disabled = used.has(opt.value) && opt.value !== current;
        });
      });
      // hash mode handled per-row in refreshOptions
    });
  }

  function suggestGroups(headers, opts) {
    if (window.LLM && window.LLM.suggestGroupsFromHeaders) return window.LLM.suggestGroupsFromHeaders(headers, opts || {});
    return Promise.resolve({ groups: [], reason: 'LLM module not available' });
  }

  // Minimal delimiter detection and CSV parser (based on uploader worker)
  function detectDelimiter(sample) {
    const candidates = [',', '\t', ';', '|'];
    const lines = sample.split(/\r?\n/).filter(Boolean);
    const line = lines[0] || '';
    let best = ','; let bestScore = -1;
    for (const d of candidates) {
      const parts = line.split(d);
      const score = parts.length;
      if (score > bestScore) { bestScore = score; best = d; }
    }
    return best;
  }

  function parseCSV(text, delimiter) {
    const rows = [];
    const len = text.length;
    let i = 0; let field = ''; let row = []; let inQuotes = false;
    const pushField = () => { row.push(field); field = ''; };
    const pushRow = () => { rows.push(row); row = []; };
    while (i < len) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          const peek = text[i + 1];
          if (peek === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += ch; i++; continue;
      } else {
        if (ch === '"') { inQuotes = true; i++; continue; }
        if (ch === delimiter) { pushField(); i++; continue; }
        if (ch === '\n') { pushField(); pushRow(); i++; continue; }
        if (ch === '\r') {
          const peek = text[i + 1];
          if (peek === '\n') { pushField(); pushRow(); i += 2; continue; }
          pushField(); pushRow(); i++; continue;
        }
        field += ch; i++; continue;
      }
    }
    if (field.length > 0 || row.length > 0) { pushField(); pushRow(); }
    return rows;
  }

  async function parseCsvText(csvText) {
    try {
      const delimiter = detectDelimiter(csvText.slice(0, 2048));
      const all = parseCSV(csvText, delimiter);
      if (!all.length) throw new Error('Empty CSV');
      headers = (all[0] || []).map(h => String(h || '').trim());
      const dataRows = all.slice(1);
      rows = dataRows.map(arr => {
        const o = {};
        for (let i=0;i<headers.length;i++) o[headers[i]] = arr[i] == null ? '' : String(arr[i]);
        return o;
      });
      if (!headers.length) throw new Error('Could not detect headers. Ensure file has a header row.');
      setMeta(`Detected ${headers.length} columns, ${rows.length} rows`);
      groupControls.style.display = '';
      // If user already confirmed groups earlier, reuse them and skip LLM
      const savedGroups = loadSavedGroups();
      groupList.innerHTML = '';
      if (Array.isArray(savedGroups) && savedGroups.length){
        setStatus('Using previously saved groups.');
        savedGroups.forEach(g => groupList.appendChild(buildGroupRow(g)));
        if (ungroupedMsg) { ungroupedMsg.style.display = 'none'; ungroupedMsg.textContent = ''; }
        updateAllOptionLocks();
        setLoading(false);
        return;
      }

      // Ask LLM for groups from headers only
      setLoading(true);
      const result = await suggestGroups(headers, {});
      const llmGroups = Array.isArray(result) ? result : (Array.isArray(result.groups) ? result.groups : []);
      const reason = Array.isArray(result) ? null : (result && result.reason) || null;
      let ungrouped = Array.isArray(result && result.ungrouped) ? result.ungrouped : [];
      if (llmGroups.length) {
        setStatus('LLM proposed groups. Review and adjust.');
        llmGroups.forEach(g => groupList.appendChild(buildGroupRow(g)));
      } else {
        const msg = reason ? `No groups proposed by LLM: ${reason}. You can add groups manually.` : 'No groups proposed. Add groups manually.';
        setStatus(msg);
        groupList.appendChild(buildGroupRow(null));
      }
      // Convert any ungrouped columns into standalone groups to ensure full coverage
      if (ungrouped.length) {
        ungrouped.forEach(u => {
          const h = u && u.column;
          if (!h) return;
          groupList.appendChild(buildGroupRow({ id: h, en: h, ar: h, idStrategy: 'column' }));
        });
        if (ungroupedMsg) { ungroupedMsg.style.display = 'none'; ungroupedMsg.textContent = ''; }
      } else if (ungroupedMsg) {
        ungroupedMsg.style.display = 'none';
        ungroupedMsg.textContent = '';
      }
      updateAllOptionLocks();
      setLoading(false);
    } catch (e) {
      setStatus('Parse error: ' + (e?.message || e));
      setLoading(false);
    }
  }

  function initFromSession() {
    const csvText = sessionStorage.getItem('uploadedCsvText');
    if (!csvText) {
      setStatus('No uploaded CSV found. Please upload again.');
      reuploadSec.style.display = '';
      groupControls.style.display = 'none';
      setMeta('Waiting for CSV…');
      return;
    }
    reuploadSec.style.display = 'none';
    parseCsvText(csvText);
  }

  reuploadInput.addEventListener('change', () => {
    const f = reuploadInput.files && reuploadInput.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onerror = () => setStatus('Failed to read CSV.');
    reader.onload = () => {
      const text = String(reader.result || '');
      try { sessionStorage.setItem('uploadedCsvText', text); } catch {}
      parseCsvText(text);
    };
    reader.readAsText(f);
  });

  addGroupBtn.addEventListener('click', () => { groupList.appendChild(buildGroupRow(null)); updateAllOptionLocks(); });

  // Force-include UI removed by request; LLM now groups all columns.

  // No hash logic required; IDs must come from a selected column

  // Removed Apply Grouping button and preview; proceed directly to Confirm when ready

  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => {
      const groups = Array.from(groupList.children).map(r => r.getValue());
      // Reuse validation
      const used = new Set();
      for (const g of groups) {
        if (!g.en || !g.ar) { setStatus('Each group needs EN and AR.'); return; }
        const cols = [g.en, g.ar];
        if (g.idStrategy === 'column') {
          if (!g.id) { setStatus('ID column missing or select Hash for ID.'); return; }
          cols.push(g.id);
        }
        // Only check unique columns from this group against previously used ones
        const uniqueInGroup = Array.from(new Set(cols));
        for (const c of uniqueInGroup) {
          if (used.has(c)) { setStatus('Columns must not be reused across groups.'); return; }
        }
        uniqueInGroup.forEach(c => used.add(c));
      }
      try {
        // Persist grouping for naming step
        sessionStorage.setItem('groupingDefinition', JSON.stringify(groups));
        // Navigate inside master layout to naming step
        const target = encodeURIComponent('mapper/datagrouping/naming.html');
        const inMaster = !!document.querySelector('.layout') || !!document.getElementById('content');
        if (inMaster) window.location.hash = '#/' + target; else window.location.href = '/Index.html#/' + target;
      } catch (e) {
        setStatus('Failed to save groups for next step.');
      }
    });
  }

  initFromSession();
  checkLlmHealth();
})();
