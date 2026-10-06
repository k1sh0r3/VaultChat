/* VaultChat — retrieval: cosine top-k over embeddings + BM25 keyword fallback.
   Classic script (Node-testable). All functions pure. */
(function (root) {
  'use strict';

  function tokenize(text) {
    return String(text == null ? '' : text)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  }

  function dot(a, b) {
    var s = 0;
    var n = Math.min(a.length, b.length);
    for (var i = 0; i < n; i++) s += a[i] * b[i];
    return s;
  }

  function norm(a) {
    return Math.sqrt(dot(a, a));
  }

  function cosine(a, b) {
    if (!a || !b || !a.length || !b.length) return 0;
    var na = norm(a), nb = norm(b);
    if (na === 0 || nb === 0) return 0;
    return dot(a, b) / (na * nb);
  }

  /* Rank items [{vec}] against a query vector. Returns [{index, score}] desc. */
  function rankCosine(queryVec, items) {
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var v = items[i] && items[i].vec;
      out.push({ index: i, score: v ? cosine(queryVec, v) : 0 });
    }
    out.sort(function (x, y) { return y.score - x.score; });
    return out;
  }

  function topK(ranked, k) {
    k = Math.max(1, k | 0 || 3);
    return ranked.slice(0, k);
  }

  /* ---- BM25 (fallback when embeddings unavailable) ---- */
  var BM25_K1 = 1.5;
  var BM25_B = 0.75;

  /* docs: array of strings. Returns { score(queryString) -> [{index, score}] }. */
  function buildBm25(docs) {
    var tokenDocs = docs.map(tokenize);
    var N = tokenDocs.length;
    var docLens = tokenDocs.map(function (t) { return t.length; });
    var avgLen = N ? docLens.reduce(function (a, b) { return a + b; }, 0) / N : 0;
    var df = {};
    tokenDocs.forEach(function (toks) {
      var seen = {};
      toks.forEach(function (t) {
        if (!seen[t]) { seen[t] = true; df[t] = (df[t] || 0) + 1; }
      });
    });

    function score(query) {
      var qterms = tokenize(query);
      var out = [];
      for (var i = 0; i < N; i++) {
        var toks = tokenDocs[i];
        var tf = {};
        toks.forEach(function (t) { tf[t] = (tf[t] || 0) + 1; });
        var s = 0;
        qterms.forEach(function (q) {
          var f = tf[q] || 0;
          if (!f) return;
          var nq = df[q] || 0;
          var idf = Math.log(1 + (N - nq + 0.5) / (nq + 0.5));
          var denom = f + BM25_K1 * (1 - BM25_B + BM25_B * (docLens[i] / (avgLen || 1)));
          s += idf * (f * (BM25_K1 + 1)) / denom;
        });
        out.push({ index: i, score: s });
      }
      out.sort(function (x, y) { return y.score - x.score; });
      return out;
    }

    return { score: score, docCount: N };
  }

  root.VaultChat = root.VaultChat || {};
  root.VaultChat.Retrieval = {
    tokenize: tokenize,
    cosine: cosine,
    rankCosine: rankCosine,
    topK: topK,
    buildBm25: buildBm25
  };
})(typeof window !== 'undefined' ? window : globalThis);
