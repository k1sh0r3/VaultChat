/* VaultChat — BYOK LLM layer + extractive fallback + citations.
   Classic script (Node-testable). Provider pattern: buildRequest/parseResponse. */
(function (root) {
  'use strict';

  var KEY_PREFIX = 'vaultchat.key.';
  var CUSTOM_KEY = 'vaultchat.custom';

  function storage() {
    try {
      if (typeof localStorage !== 'undefined') return localStorage;
    } catch (e) { /* private mode */ }
    var mem = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
      setItem: function (k, v) { mem[k] = String(v); },
      removeItem: function (k) { delete mem[k]; }
    };
  }
  var store = storage();

  function setKey(provider, key) {
    if (key) store.setItem(KEY_PREFIX + provider, key);
    else store.removeItem(KEY_PREFIX + provider);
  }
  function getKey(provider) { return store.getItem(KEY_PREFIX + provider) || ''; }
  function hasKey(provider) { return !!getKey(provider); }

  function getCustomConfig() {
    try { return JSON.parse(store.getItem(CUSTOM_KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function setCustomConfig(cfg) {
    cfg = cfg || {};
    store.setItem(CUSTOM_KEY, JSON.stringify({
      baseUrl: String(cfg.baseUrl || '').trim().replace(/\/+$/, ''),
      model: String(cfg.model || '').trim()
    }));
  }
  function customReady() {
    var c = getCustomConfig();
    return !!(getKey('custom') && c.baseUrl && c.model);
  }

  /* ---------- provider adapters ---------- */
  function openAiCompatRequest(url, key, model, system, user, jsonMode) {
    var body = {
      model: model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature: 0.3
    };
    if (jsonMode !== false) body.response_format = { type: 'json_object' };
    var headers = { 'Content-Type': 'application/json' };
    if (key) headers['Authorization'] = 'Bearer ' + key;
    return { url: url, headers: headers, body: body };
  }
  function openAiParse(data) {
    try { return data.choices[0].message.content; } catch (e) { return null; }
  }

  var PROVIDERS = {
    openai: {
      label: 'OpenAI', model: 'gpt-4o-mini', placeholder: 'sk-…',
      buildRequest: function (key, system, user) {
        return openAiCompatRequest('https://api.openai.com/v1/chat/completions', key, 'gpt-4o-mini', system, user);
      },
      parseResponse: openAiParse
    },
    gemini: {
      label: 'Google Gemini', model: 'gemini-2.0-flash', placeholder: 'AIza…',
      buildRequest: function (key, system, user) {
        return {
          url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + encodeURIComponent(key),
          headers: { 'Content-Type': 'application/json' },
          body: {
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ parts: [{ text: user }] }],
            generationConfig: { responseMimeType: 'text/plain', temperature: 0.3 }
          }
        };
      },
      parseResponse: function (data) {
        try { return data.candidates[0].content.parts.map(function (p) { return p.text; }).join(''); }
        catch (e) { return null; }
      }
    },
    groq: {
      label: 'Groq', model: 'llama-3.3-70b-versatile', placeholder: 'gsk_…',
      buildRequest: function (key, system, user) {
        return openAiCompatRequest('https://api.groq.com/openai/v1/chat/completions', key, 'llama-3.3-70b-versatile', system, user);
      },
      parseResponse: openAiParse
    },
    custom: {
      label: 'Custom (OpenAI-compatible)', model: '', placeholder: 'key — any value works for keyless local servers',
      buildRequest: function (key, system, user) {
        var cfg = getCustomConfig();
        var base = String(cfg.baseUrl || '').replace(/\/+$/, '');
        var url = /\/chat\/completions$/.test(base) ? base : base + '/chat/completions';
        return openAiCompatRequest(url, key, cfg.model, system, user, false);
      },
      parseResponse: openAiParse
    }
  };

  function defaultFetch() {
    if (typeof fetch !== 'undefined') return fetch;
    throw new Error('No fetch implementation available.');
  }

  async function chat(system, user, opts) {
    opts = opts || {};
    var provider = opts.provider || null;
    if (!provider || !PROVIDERS[provider]) return null;
    if (provider === 'custom') { if (!customReady()) return null; }
    else if (!hasKey(provider)) return null;
    var key = getKey(provider);
    var impl;
    try { impl = opts.fetchImpl || defaultFetch(); } catch (e) { return null; }
    var req = PROVIDERS[provider].buildRequest(key, system, user);
    var res;
    try {
      res = await impl(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body) });
    } catch (e) { return null; }
    if (!res.ok) return null;
    var data;
    try { data = await res.json(); } catch (e) { return null; }
    return PROVIDERS[provider].parseResponse(data);
  }

  /* ---------- RAG prompt + citations ---------- */

  /* citedChunks: [{ n, docName, page, chunkIndex, text }] */
  function buildRagPrompt(question, citedChunks) {
    var context = citedChunks.map(function (c) {
      return '[Source ' + c.n + ': ' + c.docName + ', page ' + c.page + ']\n' + c.text;
    }).join('\n\n');
    var system = 'You answer questions using ONLY the provided sources. ' +
      'Every factual claim must carry an inline citation like [1] or [2] referring to the source number. ' +
      'If the sources do not contain the answer, say so plainly instead of guessing.';
    var user = 'Sources:\n' + context + '\n\nQuestion: ' + question;
    return { system: system, user: user };
  }

  function formatCitation(c) {
    return '[' + c.n + '] ' + c.docName + ' (p.' + c.page + ', chunk ' + (c.chunkIndex + 1) + ')';
  }

  /* ---------- extractive fallback (no LLM key) ---------- */

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  function highlightTerms(text, query) {
    var terms = {};
    String(query).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(function (t) { return t.length > 2; })
      .forEach(function (t) { terms[t] = true; });
    var esc = escapeHtml(text);
    Object.keys(terms).forEach(function (t) {
      var re = new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
      esc = esc.replace(re, '<mark>$1</mark>');
    });
    return esc;
  }

  /* ranked: [{ chunk, score }] already top-k sliced. Returns { banner, html, citations }. */
  function extractiveAnswer(query, ranked) {
    var citations = ranked.map(function (r, i) {
      return { n: i + 1, docName: r.chunk.docName, page: r.chunk.page, chunkIndex: r.chunk.chunkIndex };
    });
    var html = ranked.map(function (r, i) {
      return '<div class="passage"><div class="passage-head">[' + (i + 1) + '] ' +
        escapeHtml(r.chunk.docName) + ' · p.' + r.chunk.page + '</div><p>' +
        highlightTerms(r.chunk.text, query) + '</p></div>';
    }).join('');
    return {
      banner: 'No LLM key — showing source passages instead of a generated answer.',
      html: html || '<p class="dim">No relevant passages found.</p>',
      citations: citations
    };
  }

  root.VaultChat = root.VaultChat || {};
  root.VaultChat.LLM = {
    PROVIDERS: PROVIDERS,
    setKey: setKey, getKey: getKey, hasKey: hasKey,
    getCustomConfig: getCustomConfig, setCustomConfig: setCustomConfig, customReady: customReady,
    chat: chat,
    buildRagPrompt: buildRagPrompt,
    formatCitation: formatCitation,
    extractiveAnswer: extractiveAnswer,
    highlightTerms: highlightTerms,
    escapeHtml: escapeHtml
  };
})(typeof window !== 'undefined' ? window : globalThis);
