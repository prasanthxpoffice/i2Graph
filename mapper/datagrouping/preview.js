(() => {
  const statusEl = document.getElementById('status');
  const metaEl = document.getElementById('meta');
  const backBtn = document.getElementById('backBtn');

  const jq = (typeof window !== 'undefined' && window.jQuery) ? window.jQuery : null;
  const jqGridSel = '#jqgrid';
  const jqPagerSel = '#jqgridPager';
  const jqReady = !!(jq && jq.fn && jq.fn.jqGrid);

  function lang(){
    const l = document.documentElement.getAttribute('lang')||'';
    const d = document.documentElement.getAttribute('dir')||'';
    return (l.toLowerCase()==='ar' || d.toLowerCase()==='rtl') ? 'ar' : 'en';
  }

  function setStatus(t){ if (statusEl) statusEl.textContent = t || ''; }
  function setMeta(t){ if (metaEl) metaEl.textContent = t || ''; }

  function detectDelimiter(sample) {
    const candidates = [',', '\t', ';', '|'];
    const lines = sample.split(/\r?\n/).filter(Boolean);
    const line = lines[0] || '';
    let best = ','; let bestScore = -1;
    for (const d of candidates) { const parts = line.split(d); const score = parts.length; if (score > bestScore) { bestScore = score; best = d; } }
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
        if (ch === '\r') { const peek = text[i + 1]; if (peek === '\n') { pushField(); pushRow(); i += 2; continue; } pushField(); pushRow(); i++; continue; }
        field += ch; i++; continue;
      }
    }
    if (field.length > 0 || row.length > 0) { pushField(); pushRow(); }
    return rows;
  }

  function simpleHash(str){
    let h = 0; for (let i=0;i<str.length;i++){ h = ((h<<5)-h) + str.charCodeAt(i); h |= 0; }
    return Math.abs(h).toString(36);
  }

  async function sha256Hex(str){
    try {
      if (window.crypto && window.crypto.subtle) {
        const enc = new TextEncoder();
        const data = enc.encode(str);
        const digest = await window.crypto.subtle.digest('SHA-256', data);
        const bytes = new Uint8Array(digest);
        let hex = '';
        for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
        return hex;
      }
    } catch (_) { /* fallback below */ }
    return simpleHash(str);
  }

  function ensureJqGrid(colModel, data, groupHeaders){
    if (!jqReady) { setStatus('jqGrid library not loaded (open via main Index.html).'); return; }
    try { jq(jqGridSel).jqGrid('GridUnload'); } catch (_) {}
    jq(jqGridSel).jqGrid({
      datatype: 'local',
      data,
      colModel,
      height: 'auto',
      shrinkToFit: true,
      rowNum: 20,
      rowList: [20,50,100,200],
      pager: jqPagerSel,
      viewrecords: true,
      autowidth: true,
      guiStyle: 'jQueryUI',
      iconSet: 'jQueryUI',
      jsonReader: { repeatitems: false, id: 'id' }
    });
    try {
      if (Array.isArray(groupHeaders) && groupHeaders.length) {
        jq(jqGridSel).jqGrid('setGroupHeaders', {
          useColSpanStyle: true,
          groupHeaders
        });
      }
    } catch (_) {}
    jq(jqGridSel).jqGrid('filterToolbar', { defaultSearch: 'cn', searchOnEnter: false });
    try { jq(jqGridSel).jqGrid('navGrid', jqPagerSel, { add:false, edit:false, del:false, search:false, refresh:true }); } catch (_) {}
    try {
      const $c = jq('#jqgrid-container');
      const cw = $c.width();
      jq(jqGridSel).jqGrid('setGridWidth', cw > 0 ? cw : 800);
      jq(jqGridSel).trigger('reloadGrid', [{ current: true }]);
    } catch (_) {}
  }

  function loadSessionJson(key){ try { return JSON.parse(sessionStorage.getItem(key)||'[]'); } catch { return []; } }

  // Keep parsed CSV + settings for language-aware rendering
  let lastHeaders = [];
  let lastDataRows = [];
  let lastGroups = [];
  let lastNames = [];

  async function buildGridSpecWithHash(headers, dataRows, groups, names, lng){
    const hIndex = new Map(headers.map((h,i)=>[h,i]));
    const colModel = [{ name: 'id', label: (lng==='ar' ? 'Row #' : 'Row #'), width: 60, align:'right' }];
    const groupHeaders = [];
    const groupsMeta = [];
    groups.forEach((g, gi) => {
      const nm = names.find(n=>n.index===gi) || {};
      const nameEn = String(nm.en || g.en || `Group ${gi+1}`).trim();
      const nameAr = String(nm.ar || g.ar || '').trim();
      const groupTitle = (lng==='ar') ? (nameAr || nameEn) : (nameEn || nameAr);

      const idKey = `g${gi}_id`;
      const enKey = `g${gi}_en`;
      const arKey = `g${gi}_ar`;
      const hashKey = `g${gi}_hash`;

      const idIdx = g && g.id ? hIndex.get(g.id) : null;
      const enIdx = g && g.en ? hIndex.get(g.en) : null;
      const arIdx = g && g.ar ? hIndex.get(g.ar) : null;

      colModel.push({ name: idKey, label: `${groupTitle} - ID`, index: idKey, width: 140, align:'left' });
      colModel.push({ name: enKey, label: `${groupTitle} - EN`, index: enKey, width: 160, align:'left' });
      colModel.push({ name: arKey, label: `${groupTitle} - AR`, index: arKey, width: 160, align:'left' });
      colModel.push({ name: hashKey, label: `${groupTitle} - HASH`, index: hashKey, width: 160, align:'left' });

      groupsMeta.push({ gi, idKey, enKey, arKey, hashKey, idIdx, enIdx, arIdx, title: groupTitle });
      groupHeaders.push({ startColumnName: idKey, numberOfColumns: 4, titleText: groupTitle });
    });

    // Step 1: compute EN/AR fallback values per row/group
    const enDispRows = dataRows.map(() => Array(groupsMeta.length).fill(''));
    const arDispRows = dataRows.map(() => Array(groupsMeta.length).fill(''));
    for (let ri = 0; ri < dataRows.length; ri++){
      const arr = dataRows[ri];
      for (let gi = 0; gi < groupsMeta.length; gi++){
        const m = groupsMeta[gi];
        const enRaw = Number.isInteger(m.enIdx) ? String(arr[m.enIdx] || '') : '';
        const arRaw = Number.isInteger(m.arIdx) ? String(arr[m.arIdx] || '') : '';
        enDispRows[ri][gi] = enRaw || arRaw || '';
        arDispRows[ri][gi] = arRaw || enRaw || '';
      }
    }

    // Step 2: per-group ID resolved using Step 1 fallback values
    const comboIdMaps = groupsMeta.map(() => new Map()); // [Map<comboKey, idVal>]
    // Pass 1: collect existing IDs
    for (let ri = 0; ri < dataRows.length; ri++){
      const arr = dataRows[ri];
      for (let gi = 0; gi < groupsMeta.length; gi++){
        const m = groupsMeta[gi];
        const enDisp = enDispRows[ri][gi];
        const arDisp = arDispRows[ri][gi];
        const key = `en:${enDisp.toLowerCase()}|ar:${arDisp.toLowerCase()}`;
        const idCell = Number.isInteger(m.idIdx) ? String(arr[m.idIdx] || '') : '';
        if (idCell && !comboIdMaps[gi].has(key)) comboIdMaps[gi].set(key, idCell);
      }
    }
    // Pass 2: resolve/generate IDs and compute group hash (Step 3)
    const data = [];
    for (let ri = 0; ri < dataRows.length; ri++){
      const arr = dataRows[ri];
      const obj = { id: ri + 1 };
      for (let gi = 0; gi < groupsMeta.length; gi++){
        const m = groupsMeta[gi];
        const enDisp = enDispRows[ri][gi];
        const arDisp = arDispRows[ri][gi];
        const comboKey = `en:${enDisp.toLowerCase()}|ar:${arDisp.toLowerCase()}`;

        const idCell = Number.isInteger(m.idIdx) ? String(arr[m.idIdx] || '') : '';
        let idVal = idCell || comboIdMaps[gi].get(comboKey) || '';
        if (!idVal && comboKey.trim()) {
          idVal = await sha256Hex(comboKey);
          comboIdMaps[gi].set(comboKey, idVal);
        }

        obj[m.idKey] = idVal;
        obj[m.enKey] = enDisp;
        obj[m.arKey] = arDisp;
        obj[m.hashKey] = await sha256Hex(`id:${idVal}|${comboKey}`);
      }
      data.push(obj);
    }

    return { colModel, groupHeaders, data };
  }

  async function rerenderForLang(){
    const lng = lang();
    const spec = await buildGridSpecWithHash(lastHeaders, lastDataRows, lastGroups, lastNames, lng);
    ensureJqGrid(spec.colModel, spec.data, spec.groupHeaders);
  }

  async function init(){
    const text = sessionStorage.getItem('uploadedCsvText') || '';
    if (!text){ setStatus('No CSV found in session. Please upload again.'); setMeta(''); return; }

    // Parse CSV (assume header row present)
    const delimiter = detectDelimiter(text.slice(0, 2048));
    const all = parseCSV(text, delimiter);
    if (!all.length){ setStatus('CSV appears empty.'); setMeta(''); return; }
    const headers = (all[0] || []).map(h=>String(h||'').trim());
    const dataRows = all.slice(1);

    const groups = loadSessionJson('groupingDefinition');
    const names = loadSessionJson('groupNames');
    const nodes = loadSessionJson('nodesDefinition');
    const rels = loadSessionJson('relationshipsDefinition');

    setMeta(`${headers.length} columns, ${dataRows.length} rows – ${groups.length} group(s) – ${nodes.filter(n=>n.isNode).length} node(s) – ${rels.length} relationship(s)`);

    lastHeaders = headers;
    lastDataRows = dataRows;
    lastGroups = groups;
    lastNames = names;
    await rerenderForLang();
    if (!jqReady){ setStatus('Open via main Index.html to load jqGrid assets.'); }
  }

  if (backBtn){
    backBtn.addEventListener('click', () => {
      const target = encodeURIComponent('mapper/datagrouping/relationships.html');
      const inMaster = !!document.querySelector('.layout') || !!document.getElementById('content');
      if (inMaster) window.location.hash = '#/' + target; else window.location.href = '/Index.html#/' + target;
    });
  }

  init();
  try { window.addEventListener('lang:changed', () => { rerenderForLang(); }); } catch(_) {}
})();

