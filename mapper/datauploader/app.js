(() => {
  const fileInput = document.getElementById('fileInput');
  const delimiterSel = document.getElementById('delimiter');
  const hasHeaderChk = document.getElementById('hasHeader');
  const metaEl = document.getElementById('meta');
  const statusEl = document.getElementById('status');
  const validationEl = document.getElementById('validationError');
  const nextStepBtn = document.getElementById('nextStepBtn');
  const progress = document.getElementById('progress');
  const progressBar = document.getElementById('progressBar');
  // jqGrid handles
  const jq = (typeof window !== 'undefined' && window.jQuery) ? window.jQuery : null;
  const jqGridSel = '#jqgrid';
  const jqPagerSel = '#jqgridPager';
  let jqHeaders = [];
  let jqKeys = [];
  let jqData = [];
  const jqReady = !!(jq && jq.fn && jq.fn.jqGrid);

  let worker = null;
  let headers = [];
  let currentFile = null;
  let headersAreUnique = false;

  function resetGrid() {
    headers = [];
    jqHeaders = [];
    jqData = [];
    if (jqReady) {
      try { jq(jqGridSel).jqGrid('clearGridData', true); } catch (e) {}
    }
  }

  function formatNumber(n) {
    try { return new Intl.NumberFormat().format(n); } catch { return String(n); }
  }

  function setStatus(text) { statusEl.textContent = text || ''; }
  function setMeta(text) { metaEl.textContent = text || ''; }
  function setValidationError(text) {
    if (!validationEl) return;
    validationEl.textContent = text || '';
    if (text) {
      validationEl.style.color = '#b91c1c';
    } else {
      validationEl.removeAttribute('style');
    }
  }
  function showProgress(pct) {
    if (pct == null) { progress.setAttribute('aria-hidden', 'true'); progressBar.style.width = '0%'; return; }
    progress.removeAttribute('aria-hidden');
    progressBar.style.width = Math.max(0, Math.min(100, pct)) + '%';
  }

  

  function makeFieldKey(name, idx) {
    const base = String(name || ('C' + (idx + 1))).trim();
    let key = base.normalize ? base.normalize('NFKD') : base;
    key = key.replace(/[^\w]+/g, '_');
    if (!key || /^\d/.test(key)) key = 'C' + (idx + 1) + (key ? '_' + key : '');
    return key;
  }

  function createColModelFromHeaders(cols) {
    jqKeys = (cols || []).map((name, idx) => makeFieldKey(name, idx));
    return jqKeys.map((key, idx) => ({
      name: key,
      label: String((jqHeaders[idx] != null ? jqHeaders[idx] : key)),
      index: key,
      align: 'left',
      sortable: true,
      search: true,
      width: 120
    }));
  }

  function ensureJqGrid(headersForCols) {
    if (!jqReady) { setStatus('jqGrid library not loaded.'); return; }
    const colModel = createColModelFromHeaders(headersForCols);
    try { jq(jqGridSel).jqGrid('GridUnload'); } catch (e) { /* ignore */ }
    jq(jqGridSel).jqGrid({
      datatype: 'local',
      data: jqData,
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
    jq(jqGridSel).jqGrid('filterToolbar', { defaultSearch: 'cn', searchOnEnter: false });
    try { jq(jqGridSel).jqGrid('navGrid', jqPagerSel, { add:false, edit:false, del:false, search:false, refresh:true }); } catch (e) {}
    try {
      const $container = jq('#jqgrid-container');
      const cw = $container.width();
      jq(jqGridSel).jqGrid('setGridWidth', cw > 0 ? cw : 800);
      // Force refresh in case columns initialized after data
      jq(jqGridSel).jqGrid('setGridParam', { data: jqData });
      jq(jqGridSel).trigger('reloadGrid', [{ current: true }]);
    } catch (e) { }

    // After grid renders, validate header uniqueness
    try {
      const seen = new Map();
      const dupSet = new Set();
      (headersForCols || []).forEach((h) => {
        const k = String(h == null ? '' : h).trim().toLowerCase();
        if (!k) return;
        if (seen.has(k)) dupSet.add(h);
        else seen.set(k, 1);
      });
      const duplicates = Array.from(dupSet);
      if (duplicates.length) {
        headersAreUnique = false;
        setValidationError('Duplicate column headers found: ' + duplicates.join(', '));
      } else {
        headersAreUnique = true;
        setValidationError('');
      }
      if (nextStepBtn) nextStepBtn.disabled = !(headersAreUnique && !!currentFile);
    } catch (err) { /* noop */ }
  }

  function appendRowsToJq(chunk) {
    if (!jqReady || !Array.isArray(chunk) || !jqHeaders.length) return;
    const startId = jqData.length + 1;
    const mapped = chunk.map((arr, i) => {
      const obj = { id: startId + i };
      for (let c = 0; c < jqHeaders.length; c++) {
        const key = jqKeys[c] || makeFieldKey(jqHeaders[c], c);
        obj[key] = arr[c] == null ? '' : String(arr[c]);
      }
      return obj;
    });
    jqData.push(...mapped);
    try {
      jq(jqGridSel).jqGrid('setGridParam', { data: jqData });
      jq(jqGridSel).trigger('reloadGrid', [{ current: true }]);
      // Fallback: if grid still reports zero records, force addRowData
      const recs = jq(jqGridSel).jqGrid('getGridParam','records') || jq(jqGridSel).jqGrid('getGridParam','reccount') || 0;
      if (!recs && jqData.length) {
        jq(jqGridSel).jqGrid('clearGridData', true);
        for (var k = 0; k < jqData.length; k++) {
          jq(jqGridSel).jqGrid('addRowData', jqData[k].id, jqData[k]);
        }
        jq(jqGridSel).jqGrid('setGridParam', { page: 1 });
        jq(jqGridSel).trigger('reloadGrid');
      }
    } catch (e) { /* noop */ }
  }

  

  function startWorkerParse(file, delimiter, hasHeader) {
    if (worker) { worker.terminate(); worker = null; }
    try {
      worker = new Worker('/mapper/datauploader/csvWorker.js');
    } catch (err) {
      setStatus('Failed to start CSV worker. Open in a local server or allow file access.');
      return;
    }
    showProgress(0);
    setStatus('Parsing…');
    setMeta(`${file.name} — ${formatNumber(file.size)} bytes`);
    worker.onmessage = (e) => {
      const msg = e.data || {};
      if (msg.type === 'progress') {
        showProgress(msg.value);
        return;
      }
      if (msg.type === 'headers') {
        headers = msg.headers || [];
        jqHeaders = headers.slice();
        jqData = [];
        if (jqReady) {
          ensureJqGrid(jqHeaders);
        }
        setStatus(`Headers ready: ${headers.length} columns`);
        return;
      }
      if (msg.type === 'rows') {
        appendRowsToJq(msg.rows || []);
        try { setStatus(`Loaded ${formatNumber(jqData.length)} rows, ${headers.length} columns.`); } catch {}
        return;
      }
      if (msg.type === 'done') {
        showProgress();
        setStatus(`Loaded ${formatNumber(jqData.length)} rows, ${headers.length} columns.`);
        return;
      }
      if (msg.type === 'error') {
        showProgress();
        setStatus('Error: ' + (msg.error || 'Unknown'));
        return;
      }
      // Unknown message type
      try { console.warn('Unknown worker message', msg); } catch {}
    };
    worker.onerror = (ev) => {
      showProgress();
      setStatus('Worker error: ' + (ev && (ev.message || ev.filename) || 'unknown'));
    };
    worker.postMessage({ type: 'parse', file, delimiter, hasHeader });
  }

  window.addEventListener('resize', () => {
    if (jqReady) {
      try {
        const $c = jq('#jqgrid-container');
        jq(jqGridSel).jqGrid('setGridWidth', $c.width());
      } catch (e) { }
    }
  });

  fileInput.addEventListener('change', () => {
    resetGrid();
    const f = fileInput.files && fileInput.files[0];
    if (!f) { setMeta('Waiting for file…'); setStatus(''); return; }
    const delimiter = delimiterSel.value || 'auto';
    const hasHeader = !!hasHeaderChk.checked;
    startWorkerParse(f, delimiter, hasHeader);
  });
  // Secondary listener to track file and control Next Step state
  fileInput.addEventListener('change', () => {
    currentFile = (fileInput.files && fileInput.files[0]) || null;
    if (nextStepBtn) nextStepBtn.disabled = !(headersAreUnique && !!currentFile);
  });

  if (nextStepBtn) {
    nextStepBtn.addEventListener('click', () => {
      if (!currentFile || !headersAreUnique) return;
      try {
        setStatus('Preparing next step...');
        const reader = new FileReader();
        reader.onerror = () => setStatus('Failed to read file for next step.');
        reader.onload = () => {
          try {
            const text = String(reader.result || '');
            sessionStorage.setItem('uploadedCsvText', text);
            // Route within master layout if present; otherwise open master with hash
            var target = encodeURIComponent('mapper/datagrouping/index.html');
            var isInMaster = !!document.querySelector('.layout') || !!document.getElementById('content');
            if (isInMaster) {
              window.location.hash = '#/' + target;
            } else {
              window.location.href = '/Index.html#/' + target;
            }
          } catch (e) {
            setStatus('Failed to store CSV in session.');
          }
        };
        reader.readAsText(currentFile);
      } catch (e) {
        setStatus('Unexpected error preparing next step.');
      }
    });
  }
})();
