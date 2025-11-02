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

  function titleCase(s){ return String(s||'').replace(/[\W_]+/g,' ').trim().replace(/\s+([a-z])/g,(m,c)=>' '+c.toUpperCase()).replace(/^([a-z])/,(m,c)=>c.toUpperCase()); }

  function makeFieldKey(name, idx) {
    const base = String(name || ('C' + (idx + 1))).trim();
    let key = base.normalize ? base.normalize('NFKD') : base;
    key = key.replace(/[^\w]+/g, '_');
    if (!key || /^\d/.test(key)) key = 'C' + (idx + 1) + (key ? '_' + key : '');
    return key;
  }

  function simpleHash(str){
    let h = 0; for (let i=0;i<str.length;i++){ h = ((h<<5)-h) + str.charCodeAt(i); h |= 0; }
    return Math.abs(h).toString(36);
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

  let lastData = null;
  let lastGroups = [];
  let lastNames = [];

  function buildHeadersForLang(groups, names, lng){
    // Build colModel and group headers with language-specific titles
    const colModel = [{ name: 'id', label: (lng==='ar'?'رقم الصف':'Row #'), width: 60, align:'right' }];
    const groupHeaders = [];
    groups.forEach((g, gi) => {
      const nm = names.find(n=>n.index===gi) || {};
      const nameEn = String(nm.en || g.en || `Group ${gi+1}`).trim();
      const nameAr = String(nm.ar || g.ar || '').trim();
      const groupTitle = (lng==='ar') ? (nameAr || nameEn) : (nameEn || nameAr);
      const base = groupTitle;
      const idKey = `g${gi}_id`;
      const enKey = `g${gi}_en`;
      const arKey = `g${gi}_ar`;
      colModel.push({ name: idKey, label: `${base} - ID`, index: idKey, width: 140, align:'left' });
      colModel.push({ name: enKey, label: `${base} - EN`, index: enKey, width: 160, align:'left' });
      colModel.push({ name: arKey, label: `${base} - AR`, index: arKey, width: 160, align:'left' });
      groupHeaders.push({ startColumnName: idKey, numberOfColumns: 3, titleText: groupTitle });
    });
    return { colModel, groupHeaders };
  }

  function rerenderForLang(){
    const lng = lang();
    const { colModel, groupHeaders } = buildHeadersForLang(lastGroups, lastNames, lng);
    ensureJqGrid(colModel, lastData || [], groupHeaders);
  }

  function init(){
    const text = sessionStorage.getItem('uploadedCsvText') || '';
    if (!text){ setStatus('No CSV found in session. Please upload again.'); setMeta(''); return; }

    // Parse CSV (assume header row present as per earlier steps)
    const delimiter = detectDelimiter(text.slice(0, 2048));
    const all = parseCSV(text, delimiter);
    if (!all.length){ setStatus('CSV appears empty.'); setMeta(''); return; }
    const headers = (all[0] || []).map(h=>String(h||'').trim());
    const dataRows = all.slice(1);

    const groups = loadSessionJson('groupingDefinition');
    const names = loadSessionJson('groupNames');
    const nodes = loadSessionJson('nodesDefinition');
    const rels = loadSessionJson('relationshipsDefinition');

    setMeta(`${headers.length} columns, ${dataRows.length} rows • ${groups.length} group(s) • ${nodes.filter(n=>n.isNode).length} node(s) • ${rels.length} relationship(s)`);

    // Build mapping from header -> index
    const hIndex = new Map(headers.map((h,i)=>[h,i]));

    // Build colModel: we will compute language-specific labels below
    const colModel = [{ name: 'id', label: 'Row #', width: 60, align:'right' }];
    const groupHeaders = [];
    const fields = []; // [{ key, idx, type }]
    groups.forEach((g, gi) => {
      const nm = names.find(n=>n.index===gi);
      const base = (nm && (nm.en || nm.name)) || g.en || g.ar || `Group ${gi+1}`;
      const safeBase = titleCase(base);
      // ID column
      const idIdx = g && g.id ? hIndex.get(g.id) : null;
      const idKey = `g${gi}_id`;
      colModel.push({ name: idKey, label: `${safeBase} - ID`, index: idKey, width: 140, align:'left' });
      fields.push({ key: idKey, idx: idIdx, type: 'id', enIdx: (g && g.en ? hIndex.get(g.en) : null), arIdx: (g && g.ar ? hIndex.get(g.ar) : null) });
      // EN column
      const enKey = `g${gi}_en`;
      const enIdx = g && g.en ? hIndex.get(g.en) : null;
      colModel.push({ name: enKey, label: `${safeBase} - EN`, index: enKey, width: 160, align:'left' });
      fields.push({ key: enKey, idx: enIdx, type: 'en' });
      // AR column
      const arKey = `g${gi}_ar`;
      const arIdx = g && g.ar ? hIndex.get(g.ar) : null;
      colModel.push({ name: arKey, label: `${safeBase} - AR`, index: arKey, width: 160, align:'left' });
      fields.push({ key: arKey, idx: arIdx, type: 'ar' });

      // Group these three columns under a shared header (will be rebuilt per language below)
      groupHeaders.push({ startColumnName: idKey, numberOfColumns: 3, titleText: safeBase });
    });

    // Build jqGrid data
    const data = dataRows.map((arr, ri) => {
      const obj = { id: ri+1 };
      for (const f of fields){
        if (f.type === 'id'){
          if (Number.isInteger(f.idx)){
            obj[f.key] = arr[f.idx] == null ? '' : String(arr[f.idx]);
          } else {
            const enV = Number.isInteger(f.enIdx) ? String(arr[f.enIdx]||'') : '';
            const arV = Number.isInteger(f.arIdx) ? String(arr[f.arIdx]||'') : '';
            const combo = (enV || arV) ? `${enV}|${arV}` : '';
            obj[f.key] = combo ? simpleHash(combo) : '';
          }
        } else {
          obj[f.key] = Number.isInteger(f.idx) ? (arr[f.idx] == null ? '' : String(arr[f.idx])) : '';
        }
      }
      return obj;
    });

    // Save for language-aware rendering and render using current language
    lastData = data;
    lastGroups = groups;
    lastNames = names;
    rerenderForLang();
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
  // Re-render headers when language changes
  try { window.addEventListener('lang:changed', () => { rerenderForLang(); }); } catch(_) {}
})();
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

  function titleCase(s){ return String(s||'').replace(/[\W_]+/g,' ').trim().replace(/\s+([a-z])/g,(m,c)=>' '+c.toUpperCase()).replace(/^([a-z])/,(m,c)=>c.toUpperCase()); }

  function simpleHash(str){
    let h = 0; for (let i=0;i<str.length;i++){ h = ((h<<5)-h) + str.charCodeAt(i); h |= 0; }
    return Math.abs(h).toString(36);
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

  // Keep the parsed CSV and settings so we can rebuild on language changes
  let lastHeaders = [];
  let lastDataRows = [];
  let lastGroups = [];
  let lastNames = [];
  let lastData = [];

  function buildGridSpec(headers, dataRows, groups, names, lng){
    const hIndex = new Map(headers.map((h,i)=>[h,i]));
    const colModel = [{ name: 'id', label: (lng==='ar' ? 'رقم الصف' : 'Row #'), width: 60, align:'right' }];
    const groupHeaders = [];
    const fields = [];
    groups.forEach((g, gi) => {
      const nm = names.find(n=>n.index===gi) || {};
      const nameEn = String(nm.en || g.en || `Group ${gi+1}`).trim();
      const nameAr = String(nm.ar || g.ar || '').trim();
      const groupTitle = (lng==='ar') ? (nameAr || nameEn) : (nameEn || nameAr);
      const idKey = `g${gi}_id`;
      const enKey = `g${gi}_en`;
      const arKey = `g${gi}_ar`;
      const idIdx = g && g.id ? hIndex.get(g.id) : null;
      const enIdx = g && g.en ? hIndex.get(g.en) : null;
      const arIdx = g && g.ar ? hIndex.get(g.ar) : null;
      colModel.push({ name: idKey, label: `${groupTitle} - ID`, index: idKey, width: 140, align:'left' });
      colModel.push({ name: enKey, label: `${groupTitle} - EN`, index: enKey, width: 160, align:'left' });
      colModel.push({ name: arKey, label: `${groupTitle} - AR`, index: arKey, width: 160, align:'left' });
      fields.push({ key: idKey, idx: idIdx, type: 'id', enIdx, arIdx });
      fields.push({ key: enKey, idx: enIdx, type: 'en' });
      fields.push({ key: arKey, idx: arIdx, type: 'ar' });
      groupHeaders.push({ startColumnName: idKey, numberOfColumns: 3, titleText: groupTitle });
    });
    const data = dataRows.map((arr, ri) => {
      const obj = { id: ri+1 };
      for (const f of fields){
        if (f.type === 'id'){
          if (Number.isInteger(f.idx)){
            obj[f.key] = arr[f.idx] == null ? '' : String(arr[f.idx]);
          } else {
            const enV = Number.isInteger(f.enIdx) ? String(arr[f.enIdx]||'') : '';
            const arV = Number.isInteger(f.arIdx) ? String(arr[f.arIdx]||'') : '';
            const combo = (enV || arV) ? `${enV}|${arV}` : '';
            obj[f.key] = combo ? simpleHash(combo) : '';
          }
        } else {
          obj[f.key] = Number.isInteger(f.idx) ? (arr[f.idx] == null ? '' : String(arr[f.idx])) : '';
        }
      }
      return obj;
    });
    return { colModel, groupHeaders, data };
  }

  function rerenderForLang(){
    const lng = lang();
    const spec = buildGridSpec(lastHeaders, lastDataRows, lastGroups, lastNames, lng);
    lastData = spec.data;
    ensureJqGrid(spec.colModel, spec.data, spec.groupHeaders);
  }

  function init(){
    const text = sessionStorage.getItem('uploadedCsvText') || '';
    if (!text){ setStatus('No CSV found in session. Please upload again.'); setMeta(''); return; }

    // Parse CSV (assume header row present as per earlier steps)
    const delimiter = detectDelimiter(text.slice(0, 2048));
    const all = parseCSV(text, delimiter);
    if (!all.length){ setStatus('CSV appears empty.'); setMeta(''); return; }
    const headers = (all[0] || []).map(h=>String(h||'').trim());
    const dataRows = all.slice(1);

    const groups = loadSessionJson('groupingDefinition');
    const names = loadSessionJson('groupNames');
    const nodes = loadSessionJson('nodesDefinition');
    const rels = loadSessionJson('relationshipsDefinition');

    setMeta(`${headers.length} columns, ${dataRows.length} rows • ${groups.length} group(s) • ${nodes.filter(n=>n.isNode).length} node(s) • ${rels.length} relationship(s)`);

    // Save for language-aware rendering and render using current language
    lastHeaders = headers;
    lastDataRows = dataRows;
    lastGroups = groups;
    lastNames = names;
    rerenderForLang();
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
  // Re-render headers/data when language changes
  try { window.addEventListener('lang:changed', () => { rerenderForLang(); }); } catch(_) {}
})();
