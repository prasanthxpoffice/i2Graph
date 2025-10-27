// CSV parsing worker: receives { type:'parse', file, delimiter, hasHeader }
// Posts messages: 'progress' {value}, 'headers' {headers}, 'rows' {rows}, 'done', 'error'

/* eslint-disable no-restricted-globals */
(() => {
  // Simple delimiter auto-detect from first non-empty line
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

  // Robust-ish CSV row parser for a chunk of text (no streaming across calls)
  // Returns array of rows (arrays). Supports quoted fields, escaped quotes, and newlines in quotes.
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
          if (peek === '"') { field += '"'; i += 2; continue; } // escaped quote
          inQuotes = false; i++; continue;
        }
        field += ch; i++; continue;
      } else {
        if (ch === '"') { inQuotes = true; i++; continue; }
        if (ch === delimiter) { pushField(); i++; continue; }
        if (ch === '\n') { pushField(); pushRow(); i++; continue; }
        if (ch === '\r') { // handle CRLF or bare CR
          const peek = text[i + 1];
          if (peek === '\n') { pushField(); pushRow(); i += 2; continue; }
          pushField(); pushRow(); i++; continue;
        }
        field += ch; i++; continue;
      }
    }
    // flush last field/row if any content or non-empty
    if (field.length > 0 || row.length > 0) { pushField(); pushRow(); }
    return rows;
  }

  function post(type, payload) { self.postMessage(Object.assign({ type }, payload || {})); }

  self.onmessage = async (e) => {
    const msg = e.data || {};
    if (msg.type !== 'parse') return;
    try {
      const file = msg.file; if (!file) throw new Error('No file provided');
      let delimiter = msg.delimiter === 'auto' ? null : (msg.delimiter || ',');
      const hasHeader = !!msg.hasHeader;

      // Read whole file in worker thread to avoid blocking UI
      // Using FileReaderSync which is available in dedicated workers
      const reader = new FileReaderSync();
      const text = reader.readAsText(file);

      if (!delimiter) delimiter = detectDelimiter(text.slice(0, 2048));

      // Parse all rows
      const allRows = parseCSV(text, delimiter);
      if (!allRows.length) { post('done'); return; }

      let headers = [];
      let dataRows = allRows;
      if (hasHeader) {
        headers = allRows[0] || [];
        dataRows = allRows.slice(1);
      } else {
        // generate col names C1..Cn from the widest row in first 100 rows
        const width = Math.max( ...allRows.slice(0, 100).map(r => r.length), 0 );
        headers = Array.from({ length: width }, (_, i) => `C${i+1}`);
      }

      post('headers', { headers });

      // Send in chunks to avoid large postMessage payloads
      const total = dataRows.length;
      const chunkSize = 5000;
      for (let i = 0; i < total; i += chunkSize) {
        const slice = dataRows.slice(i, i + chunkSize);
        post('rows', { rows: slice });
        const pct = Math.round(((i + slice.length) / total) * 100);
        post('progress', { value: pct });
      }

      post('done');
    } catch (err) {
      post('error', { error: (err && err.message) || String(err) });
    }
  };
})();

