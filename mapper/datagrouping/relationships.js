(() => {
  const statusEl = document.getElementById('status');
  const metaEl = document.getElementById('meta');
  // Using global spinner via window.Activity; no page-local spinner
  const relsEl = document.getElementById('rels');
  const saveBtn = document.getElementById('saveRelsBtn');

  function setStatus(t){ statusEl.textContent = t || ''; }
  function setMeta(t){ metaEl.textContent = t || ''; }
  function setLoading(b){ saveBtn.disabled = !!b; }

  function loadNodes(){ try { return JSON.parse(sessionStorage.getItem('nodesDefinition')||'[]'); } catch { return []; } }
  function loadGroupNames(){ try { return JSON.parse(sessionStorage.getItem('groupNames')||'[]'); } catch { return []; } }

  function activeNodes(){
    const nodes = (loadNodes()||[]).filter(n=>!!n.isNode);
    const names = new Map((loadGroupNames()||[]).map(x=>[x.index,x]));
    return nodes.map(n => ({ index: n.index, en: n.en || names.get(n.index)?.en || `Node ${n.index+1}`, ar: n.ar || names.get(n.index)?.ar || '' }));
  }

  async function suggestRelationships(nodes){
    // Ask LLM to propose relationships between nodes with EN/AR and direction
    try { if (!window.LLM || !window.LLM.getProvider) throw new Error('LLM missing'); } catch(e){ return []; }
    try {
      const cfg = await window.LLM.init();
      const apiBase = (cfg.apiBase || '/api').replace(/\/$/, '');
      const sys = [
        'You are assisting with Neo4j data modeling.',
        'Given a list of node labels with English and Arabic, propose likely relationships between nodes.',
        'For each relationship, output: from index, to index, name in English (en), Arabic (ar), and direction as one of "out", "in", or "both" (meaning A->B, A<-B, or both ways).',
        'Output STRICT JSON ONLY: { "rels": [ { "from": number, "to": number, "en": string, "ar": string, "dir": "out"|"in"|"both" } ] }.'
      ].join('\n');
      const user = JSON.stringify({ nodes });
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
      const rels = Array.isArray(json.rels) ? json.rels : [];
      return rels.map(r => ({ from: Number(r.from), to: Number(r.to), en: String(r.en||''), ar: String(r.ar||''), dir: (r.dir==='in'||r.dir==='both')?r.dir:'out', include: true }));
    } catch(e){ return []; }
    finally { setLoading(false); try { window.Activity && window.Activity.end(); } catch(_) {} }
  }

  function renderTable(nodes, rels){
    relsEl.innerHTML = '';
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const thr = document.createElement('tr');
    ['Include','Source Node','Target Node','Relationship EN','Relationship AR','Direction'].forEach(h=>{
      const th=document.createElement('th'); th.textContent=h; th.style.padding='6px 8px'; th.style.borderBottom='1px solid #ddd'; thr.appendChild(th);
    });
    thead.appendChild(thr); table.appendChild(thead);
    const tbody = document.createElement('tbody');

    // Build default candidate pairs if no suggestions
    if (!rels.length) {
      for (let i=0;i<nodes.length;i++){
        for (let j=0;j<nodes.length;j++){
          if (i===j) continue;
          rels.push({ from: nodes[i].index, to: nodes[j].index, en: '', ar: '', dir: 'out', include: false });
        }
      }
    }

    const nodesByIndex = new Map(nodes.map(n=>[n.index,n]));
    rels.forEach((r, idx) => {
      const tr = document.createElement('tr');
      const tdInc=document.createElement('td'); const inc=document.createElement('input'); inc.type='checkbox'; inc.className='relInc'; inc.checked=!!r.include; inc.setAttribute('data-row', String(idx)); tdInc.appendChild(inc);
      const tdSrc=document.createElement('td'); const srcSel=document.createElement('select'); srcSel.className='nodeSelFrom'; nodes.forEach(n=>{ const o=document.createElement('option'); o.value=String(n.index); o.textContent=n.en || `Node ${n.index+1}`; if(n.index===r.from) o.selected=true; srcSel.appendChild(o); }); tdSrc.appendChild(srcSel);
      const tdDst=document.createElement('td'); const dstSel=document.createElement('select'); dstSel.className='nodeSelTo'; nodes.forEach(n=>{ const o=document.createElement('option'); o.value=String(n.index); o.textContent=n.en || `Node ${n.index+1}`; if(n.index===r.to) o.selected=true; dstSel.appendChild(o); }); tdDst.appendChild(dstSel);
      const tdEn=document.createElement('td'); const en=document.createElement('input'); en.type='text'; en.className='nameInput enRel'; en.value=r.en||''; tdEn.appendChild(en);
      const tdAr=document.createElement('td'); const ar=document.createElement('input'); ar.type='text'; ar.className='nameInput arRel'; ar.value=r.ar||''; tdAr.appendChild(ar);
      const tdDir=document.createElement('td'); const dir=document.createElement('select'); ['out','in','both'].forEach(d=>{ const o=document.createElement('option'); o.value=d; o.textContent=(d==='out')? 'outward (→)': (d==='in')? 'inward (←)': 'both (↔)'; if(r.dir===d) o.selected=true; dir.appendChild(o); }); tdDir.appendChild(dir);
      [tdInc,tdSrc,tdDst,tdEn,tdAr,tdDir].forEach(td=>{ td.style.padding='6px 8px'; td.style.borderBottom='1px solid #f0f0f0'; });
      tr.appendChild(tdInc); tr.appendChild(tdSrc); tr.appendChild(tdDst); tr.appendChild(tdEn); tr.appendChild(tdAr); tr.appendChild(tdDir);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody); relsEl.appendChild(table);
  }

  async function init(){
    const nodes = activeNodes();
    if (!nodes.length){ setStatus('No nodes selected. Go back and confirm nodes.'); return; }
    setMeta(`${nodes.length} node(s)`);
    const rels = await suggestRelationships(nodes);
    setStatus(rels.length ? 'LLM suggested relationships. Review and edit.' : 'Define relationships between nodes.');
    renderTable(nodes, rels);
  }

  saveBtn.addEventListener('click', () => {
    try {
      const rows = Array.from(relsEl.querySelectorAll('tbody tr'));
      const result = rows.map(tr => {
        const include = tr.querySelector('.relInc')?.checked || false;
        const from = Number(tr.querySelector('select.nodeSelFrom')?.value||'0');
        const to = Number(tr.querySelector('select.nodeSelTo')?.value||'0');
        const en = String(tr.querySelector('input.enRel')?.value||'').trim();
        const ar = String(tr.querySelector('input.arRel')?.value||'').trim();
        const dir = String(tr.querySelector('select')?.value||'out');
        return { include, from, to, en, ar, dir };
      });
      sessionStorage.setItem('relationshipsDefinition', JSON.stringify(result));
      setStatus('Saved relationships.');
    } catch (e) {
      setStatus('Failed to save relationships.');
    }
  });

  init();
})();

