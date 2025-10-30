// Global Activity manager and centered spinner
(function(){
  if (window.Activity) return; // idempotent
  let count = 0;
  let showTimer = null, hideTimer = null;

  function ensureSpinner(){
    if (document.getElementById('globalSpinner')) return;
    const sp = document.createElement('div');
    sp.id = 'globalSpinner';
    sp.setAttribute('aria-hidden','true');
    sp.style.display = 'none'; // styled by CSS
    (document.body || document.documentElement).appendChild(sp);
  }

  function setVisible(v){
    const sp = document.getElementById('globalSpinner');
    if (sp) sp.style.display = v ? 'inline-block' : 'none';
    try { window.dispatchEvent(new CustomEvent('activity:change', { detail: { active: v, count } })); } catch(_) {}
  }

  function show(){ clearTimeout(hideTimer); setVisible(true); }
  function hide(){ setVisible(false); }

  function start(){ try { ensureSpinner(); } catch(_) {} count++; if (count===1){ clearTimeout(showTimer); showTimer=setTimeout(show,150);} }
  function end(){ if (count>0) count--; if (count===0){ clearTimeout(showTimer); clearTimeout(hideTimer); hideTimer=setTimeout(hide,150);} }
  async function wrap(p){ start(); try { return await p; } finally { end(); } }

  window.Activity = { start, end, wrap };
})();

