// Generic, provider-agnostic LLM utilities for the app
// window.LLM exposes:
// - init()
// - getProvider()
// - providers: { HeuristicProvider, ProxyProvider }
// - suggestRolesForColumns(headers, rows)
// - suggestGroupsFromHeaders(headers, opts?)

(function () {
  const DEFAULTS = {
    apiBase: '/api' // e.g. your proxy that maps to OpenAI or any LLM
  };

  let _configPromise = null;
  let _config = null;

  async function loadConfig() {
    if (_configPromise) return _configPromise;
    _configPromise = (async () => {
      try {
        const inline = (typeof window !== 'undefined' && window.LLM_CONFIG) || {};
        let fileCfg = {};
        try {
          const res = await fetch('/config.json', { cache: 'no-store' });
          if (res.ok) fileCfg = await res.json();
        } catch (_) {}
        // FIX: actually merge DEFAULTS + fileCfg + inline (inline wins)
        _config = { ...DEFAULTS, ...(fileCfg || {}), ...(inline || {}) };
        return _config;
      } catch (e) {
        _config = { ...DEFAULTS };
        return _config;
      }
    })();
    return _configPromise;
  }

  // ---------- Heuristics ----------
  const containsArabic = (text) => /[\u0600-\u06FF]/.test(String(text || ''));
  const normalize = (s) => String(s || '').toLowerCase().replace(/[_\s-]+/g, '');

  function heuristicSuggest(headers, rows) {
    headers = headers || [];
    const sample = (rows || []).slice(0, 25);
    const norm = new Map(headers.map(h => [h, normalize(h)]));

    // Try to find ID, EN, AR individually (very lightweight)
    let id = null, en = null, ar = null;

    // 1) Header name hints
    headers.forEach(h => {
      const n = norm.get(h);
      if (!id && (n === 'id' || n.endsWith('id') || n.includes('identifier'))) id = h;
      if (!en && (n.endsWith('en') || /name|label|title|text$/.test(n))) en = h;
      if (!ar && (n.endsWith('ar') || n.includes('arabic'))) ar = h;
    });

    // 2) Language content hints from sample
    if ((!ar || !en) && sample.length) {
      headers.forEach(h => {
        const vals = sample.map(r => r[h]).filter(v => v != null);
        if (!ar) {
          const arHits = vals.reduce((a,v) => a + (containsArabic(v) ? 1 : 0), 0);
          if (arHits >= Math.max(2, Math.ceil(vals.length * 0.2))) ar = h;
        }
      });
      if (ar && (!en || en === ar)) {
        // pick any non-Arabic-ish column as EN
        for (const h of headers) {
          if (h === ar) continue;
          const vals = sample.map(r => r[h]).filter(v => v != null);
          const anyAr = vals.some(containsArabic);
          if (!anyAr) { en = h; break; }
        }
      }
    }

    const chosen = { id: id || null, en: en || null, ar: ar || null };
    const filled = ['id','en','ar'].reduce((n,k)=> n + (chosen[k] ? 1 : 0), 0);
    return { ...chosen, confidence: filled / 3 };
  }

  class HeuristicProvider {
    async suggestRoles(headers, rows) {
      return heuristicSuggest(headers, rows);
    }
    async suggestGroupsFromHeaders(headers, opts = {}) {
      // Minimal header-only grouping (trio, id+name, single text)
      headers = headers || [];
      const used = new Set();
      const groups = [];
      const norm = new Map(headers.map(h => [h, normalize(h)]));

      // Trio: <base>id + <base>nameen|en + <base>namear|ar
      headers.forEach(hId => {
        if (used.has(hId)) return;
        const nId = norm.get(hId);
        if (!nId.endsWith('id')) return;
        const base = nId.slice(0, -2);
        const hEN = headers.find(h => !used.has(h) && (norm.get(h) === base + 'nameen' || norm.get(h) === base + 'en'));
        const hAR = headers.find(h => !used.has(h) && (norm.get(h) === base + 'namear' || norm.get(h) === base + 'ar'));
        if (hEN && hAR) { used.add(hId); used.add(hEN); used.add(hAR); groups.push({ id:hId, en:hEN, ar:hAR, idStrategy:'column' }); }
      });

      // ID+NAME → EN/AR = NAME
      headers.forEach(hId => {
        if (used.has(hId)) return;
        const nId = norm.get(hId);
        if (!nId.endsWith('id')) return;
        const base = nId.slice(0, -2);
        const hName = headers.find(h => !used.has(h) && norm.get(h) === base + 'name');
        if (hName) { used.add(hId); used.add(hName); groups.push({ id:hId, en:hName, ar:hName, idStrategy:'column' }); }
      });

      // Single text-y column → hash (very conservative)
      headers.forEach(h => {
        if (used.has(h)) return;
        const n = norm.get(h);
        if (n.endsWith('name') || n.includes('department') || n.endsWith('title') || n.endsWith('label')) {
          used.add(h); groups.push({ id:null, en:h, ar:h, idStrategy:'hash' });
        }
      });

      // Forced includes (if any)
      const forced = new Set(opts.forcedIncludes || []);
      headers.forEach(h => {
        if (forced.has(h) && !used.has(h)) { used.add(h); groups.push({ id:h, en:h, ar:h, idStrategy:'column' }); }
      });

      const groupedCols = new Set(groups.flatMap(g => [g.id, g.en, g.ar].filter(Boolean)));
      const ungrouped = headers.filter(h => !groupedCols.has(h)).map(h => ({ column:h, reason:'no matching EN/AR pair or ID/NAME pattern' }));
      return { groups, ungrouped, reason: groups.length ? null : 'Heuristic-only: no groups found.' };
    }
  }

  // ---------- LLM proxy-backed provider ----------
  class ProxyProvider {
    constructor(opts) { this.opts = opts || {}; }

    async _postChat({ sys, user, temperature = 0.1 }) {
      const cfg = await loadConfig();
      const apiBase = (this.opts.apiBase || cfg.apiBase || DEFAULTS.apiBase).replace(/\/$/, '');
      const resp = await fetch(apiBase + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: sys },
            { role: 'user', content: user }
          ],
          temperature,
          // Helps with OpenAI-compatible servers; others ignore it gracefully:
          response_format: { type: 'json_object' }
        })
      });
      const raw = await resp.text();
      let data;
      try { data = JSON.parse(raw); } catch { data = null; }

      if (!resp.ok) {
        const msg = (data && (data.error?.message || data.message)) || raw.slice(0, 200) || `HTTP ${resp.status}`;
        throw new Error(`LLM proxy error: ${msg}`);
      }

      // Try direct JSON
      if (data && data.groups && data.ungrouped) return data;

      // Try OpenAI-style
      const text = data?.choices?.[0]?.message?.content ?? '';
      let jsonStr = text;
      // strip fences if present
      jsonStr = jsonStr.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '');
      let parsed;
      try { parsed = JSON.parse(jsonStr); } catch {
        const m = jsonStr.match(/\{[\s\S]*\}/);
        if (!m) throw new Error('LLM did not return JSON');
        parsed = JSON.parse(m[0]);
      }
      return parsed;
    }

    async suggestRoles(headers, rows) {
      // simple 3-field suggestion (kept for backwards compatibility)
      const sys = 'You are a helpful CSV assistant. Given CSV headers and a few sample rows, pick the most likely columns for: ID (identifier), EN (English text), AR (Arabic text). Return JSON with keys {"id","en","ar"}, using exact header names when confident; else null.';
      const user = JSON.stringify({ headers, sample: (rows || []).slice(0, 20) });
      try {
        const json = await this._postChat({ sys, user, temperature: 0.2 });
        const out = { id: json.id ?? null, en: json.en ?? null, ar: json.ar ?? null };
        const filled = ['id','en','ar'].reduce((n,k)=> n + (out[k] ? 1 : 0), 0);
        return { ...out, confidence: filled / 3 };
      } catch {
        return heuristicSuggest(headers, rows);
      }
    }

    async suggestGroupsFromHeaders(headers, opts = {}) {
      const { samples = [], forcedIncludes = [], minConfidence = 0.70 } = opts;
      const sys = [
        'You are a data-mapping assistant.',
        'Given CSV headers and sample rows, you MUST return strict JSON only (no prose).',
        'Goal: infer zero or more groups of roles: ID, EN (English text), AR (Arabic text).',
        'Rules:',
        '- Prefer matching pairs like <base>EN and <base>AR and associate an ID like <base>ID if present.',
        '- If only one text column exists for a concept (e.g., department), set EN to that column and AR to the same column, and set idStrategy to "hash" (ID = hash(EN, AR)).',
        '- If columns <base>ID and <base>NAME exist (e.g., cityid, cityname), form ID:<base>ID (idStrategy="column"), EN:<base>NAME, AR:<base>NAME.',
        '- If columns cityid, citynameen, citynamear exist, then form ID:cityid, EN:citynameen, AR:citynamear. Apply this for similar <base>id, <base>nameen, <base>namear (case-insensitive, underscores ignored).',
        '- Never reuse the same column across different roles in the same or different groups.',
        '- Use exact header names in the output.',
        '',
        'Also accept an optional array "forcedIncludes". For each header in forcedIncludes, you MUST create a standalone group:',
        '- id = that header, en = that header, ar = that header, idStrategy = "column".',
        '- Do this even if the column is numeric or has duplicates.',
        '- Do not reuse any forcedInclude column in any other group.',
        '',
        'Return STRICT JSON ONLY (no markdown) with this schema:',
        '{ "groups": [ { "id": string|null, "en": string, "ar": string, "idStrategy"?: "column"|"hash" } ],',
        '  "ungrouped": [ { "column": string, "reason": string } ] }'
      ].join('\n');

      const user = JSON.stringify({
        headers,
        samples: samples.slice(0, 50),
        constraints: { minConfidence },
        forcedIncludes: forcedIncludes
      });

      try {
        const json = await this._postChat({ sys, user, temperature: 0.1 });

        // Guardrails: dedupe/recompute leftovers
        let groups = Array.isArray(json.groups) ? json.groups : [];
        const used = new Set();
        const safe = [];
        for (const g of groups) {
          const cols = [g.id, g.en, g.ar].filter(Boolean);
          if (cols.some(c => used.has(c))) continue;
          cols.forEach(c => used.add(c));
          safe.push({
            id: g.id ?? null,
            en: g.en,
            ar: g.ar,
            idStrategy: g.idStrategy ?? (g.id == null ? 'hash' : 'column')
          });
        }
        // Ensure all forcedIncludes are present as standalone groups
        for (const h of forcedIncludes) {
          if (!used.has(h)) {
            safe.push({ id: h, en: h, ar: h, idStrategy: 'column' });
            used.add(h);
          }
        }
        const groupedCols = new Set(safe.flatMap(g => [g.id, g.en, g.ar].filter(Boolean)));
        const ungroupedAuto = (Array.isArray(json.ungrouped) ? json.ungrouped : []);
        const ungrouped = [
          ...ungroupedAuto.filter(u => u && u.column),
          ...headers.filter(h => !groupedCols.has(h)).map(h => ({ column: h, reason: 'not part of any group' }))
        ];

        return { groups: safe, ungrouped, reason: null };
      } catch (e) {
        // Fallback to heuristic grouping if LLM unavailable
        const h = new HeuristicProvider();
        return h.suggestGroupsFromHeaders(headers, { forcedIncludes });
      }
    }
  }

  const LLM = {
    async init() { await loadConfig(); return _config; },
    getProvider() { return new ProxyProvider(); },
    providers: { HeuristicProvider, ProxyProvider },

    async suggestRolesForColumns(headers, rows) {
      const p = this.getProvider();
      return p.suggestRoles(headers, rows);
    },

    // Now accepts options: { samples?, forcedIncludes?, minConfidence? }
    async suggestGroupsFromHeaders(headers, opts = {}) {
      const p = this.getProvider();
      if (p.suggestGroupsFromHeaders) return p.suggestGroupsFromHeaders(headers, opts);
      return { groups: [], reason: 'No provider available.', ungrouped: [] };
    }
  };

  window.LLM = LLM;
})();
