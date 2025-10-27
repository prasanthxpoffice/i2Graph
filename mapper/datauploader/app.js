(() => {
  const fileInput = document.getElementById('fileInput');
  const delimiterSel = document.getElementById('delimiter');
  const hasHeaderChk = document.getElementById('hasHeader');
  const metaEl = document.getElementById('meta');
  const statusEl = document.getElementById('status');
  const gridEl = document.getElementById('grid');
  const theadEl = document.getElementById('thead');
  const rowsEl = document.getElementById('rows');
  const spacerTop = document.getElementById('spacerTop');
  const spacerBottom = document.getElementById('spacerBottom');
  const progress = document.getElementById('progress');
  const progressBar = document.getElementById('progressBar');

  let worker = null;
  let headers = [];
  let rows = [];
  let rowHeight = 30; // px (matches CSS)
  const overscan = 10; // extra rows above/below viewport
  let lastRenderRange = [-1, -1];
  let raf = 0;

  function resetGrid() {
    headers = [];
    rows = [];
    theadEl.innerHTML = '';
    rowsEl.innerHTML = '';
    spacerTop.style.height = '0px';
    spacerBottom.style.height = '0px';
    gridEl.setAttribute('aria-colcount', '0');
    gridEl.setAttribute('aria-rowcount', '0');
    lastRenderRange = [-1, -1];
  }

  function formatNumber(n) {
    try { return new Intl.NumberFormat().format(n); } catch { return String(n); }
  }

  function setStatus(text) { statusEl.textContent = text || ''; }
  function setMeta(text) { metaEl.textContent = text || ''; }
  function showProgress(pct) {
    if (pct == null) { progress.setAttribute('aria-hidden', 'true'); progressBar.style.width = '0%'; return; }
    progress.removeAttribute('aria-hidden');
    progressBar.style.width = Math.max(0, Math.min(100, pct)) + '%';
  }

  function buildHeader(cols) {
    theadEl.innerHTML = '';
    const frag = document.createDocumentFragment();
    cols.forEach((name) => {
      const c = document.createElement('div');
      c.className = 'cell';
      c.textContent = name;
      frag.appendChild(c);
    });
    theadEl.appendChild(frag);
  }

  function renderVisible() {
    const height = gridEl.clientHeight || 0;
    const total = rows.length;
    if (!total || !rowHeight || !height) return;
    const viewRows = Math.ceil(height / rowHeight);
    const scrollTop = gridEl.scrollTop || 0;
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const end = Math.min(total, start + viewRows + overscan * 2);

    if (lastRenderRange[0] === start && lastRenderRange[1] === end) return;
    lastRenderRange = [start, end];

    spacerTop.style.height = (start * rowHeight) + 'px';
    spacerBottom.style.height = ((total - end) * rowHeight) + 'px';

    const frag = document.createDocumentFragment();
    rows.slice(start, end).forEach((r) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'row';
      r.forEach((v) => {
        const c = document.createElement('div');
        c.className = 'cell';
        c.textContent = v == null ? '' : String(v);
        rowEl.appendChild(c);
      });
      frag.appendChild(rowEl);
    });
    rowsEl.replaceChildren(frag);
  }

  function scheduleRender() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; renderVisible(); });
  }

  function initGrid() {
    gridEl.scrollTop = 0;
    gridEl.setAttribute('aria-colcount', String(headers.length));
    gridEl.setAttribute('aria-rowcount', String(rows.length));
    // First render a single row to measure height if needed
    if (rows.length) {
      const tmp = document.createElement('div');
      tmp.className = 'row';
      (headers.length ? headers : rows[0]).forEach(()=>{
        const c = document.createElement('div'); c.className = 'cell'; c.textContent=''; tmp.appendChild(c);
      });
      rowsEl.appendChild(tmp);
      rowHeight = tmp.getBoundingClientRect().height || rowHeight;
      rowsEl.innerHTML = '';
    }
    scheduleRender();
  }

  function startWorkerParse(file, delimiter, hasHeader) {
    if (worker) { worker.terminate(); worker = null; }
    worker = new Worker('csvWorker.js');
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
        buildHeader(headers);
        return;
      }
      if (msg.type === 'rows') {
        const before = rows.length;
        rows.push(...(msg.rows || []));
        // update aria counts periodically
        if ((rows.length - before) > 0) {
          gridEl.setAttribute('aria-rowcount', String(rows.length));
        }
        scheduleRender();
        return;
      }
      if (msg.type === 'done') {
        showProgress();
        setStatus(`Loaded ${formatNumber(rows.length)} rows, ${headers.length} columns.`);
        initGrid();
        return;
      }
      if (msg.type === 'error') {
        showProgress();
        setStatus('Error: ' + (msg.error || 'Unknown'));
        return;
      }
    };
    worker.postMessage({ type: 'parse', file, delimiter, hasHeader });
  }

  gridEl.addEventListener('scroll', scheduleRender, { passive: true });
  window.addEventListener('resize', scheduleRender);

  fileInput.addEventListener('change', () => {
    resetGrid();
    const f = fileInput.files && fileInput.files[0];
    if (!f) { setMeta('Waiting for file…'); setStatus(''); return; }
    const delimiter = delimiterSel.value || 'auto';
    const hasHeader = !!hasHeaderChk.checked;
    buildHeader([]);
    startWorkerParse(f, delimiter, hasHeader);
  });
})();

