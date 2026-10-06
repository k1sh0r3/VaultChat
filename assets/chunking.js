/* VaultChat — chunking strategies. Classic script (Node-testable via require).
   Each chunker returns [{ text, start, end }] with char offsets into the source. */
(function (root) {
  'use strict';

  function clean(text) {
    return String(text == null ? '' : text).replace(/\r\n?/g, '\n');
  }

  /* Fixed-size windows with character overlap. step = size - overlap. */
  function chunkFixed(text, opts) {
    text = clean(text);
    opts = opts || {};
    var size = Math.max(1, opts.size | 0 || 512);
    var overlap = Math.max(0, Math.min(opts.overlap | 0 || 0, size - 1));
    var step = size - overlap;
    var out = [];
    for (var start = 0; start < text.length; start += step) {
      var end = Math.min(start + size, text.length);
      var slice = text.slice(start, end);
      if (slice.trim()) out.push({ text: slice, start: start, end: end });
      if (end >= text.length) break;
    }
    return out;
  }

  /* Split into sentences on terminal punctuation. Keeps the punctuation. */
  function splitSentences(text) {
    text = clean(text).replace(/\s+/g, ' ').trim();
    if (!text) return [];
    // Split after . ! ? when followed by whitespace + capital/digit/quote/open-paren.
    var parts = text.split(/(?<=[.!?])\s+(?=[A-Z0-9"'“‘(\[])/);
    var out = [];
    var cursor = 0;
    for (var i = 0; i < parts.length; i++) {
      var s = parts[i].trim();
      if (!s) continue;
      var idx = text.indexOf(s, cursor);
      if (idx === -1) idx = cursor;
      out.push({ text: s, start: idx, end: idx + s.length });
      cursor = idx + s.length;
    }
    return out;
  }

  /* Sliding window over sentences: `window` sentences per chunk, `overlap` shared. */
  function chunkSentences(text, opts) {
    opts = opts || {};
    var window = Math.max(1, opts.window | 0 || 3);
    var overlap = Math.max(0, Math.min(opts.overlap | 0 || 0, window - 1));
    var step = window - overlap;
    var sents = splitSentences(text);
    var out = [];
    for (var i = 0; i < sents.length; i += step) {
      var slice = sents.slice(i, i + window);
      if (!slice.length) break;
      out.push({
        text: slice.map(function (s) { return s.text; }).join(' '),
        start: slice[0].start,
        end: slice[slice.length - 1].end
      });
      if (i + window >= sents.length) break;
    }
    return out;
  }

  /* Paragraph-based: split on blank lines, greedily merge small ones up to maxChars. */
  function chunkParagraphs(text, opts) {
    text = clean(text);
    opts = opts || {};
    var maxChars = Math.max(1, opts.maxChars | 0 || 1024);
    var paras = [];
    var cursor = 0;
    var raw = text.split(/\n{2,}/);
    for (var i = 0; i < raw.length; i++) {
      var p = raw[i].trim();
      if (!p) { cursor += raw[i].length + 2; continue; }
      var idx = text.indexOf(p, cursor);
      if (idx === -1) idx = cursor;
      paras.push({ text: p, start: idx, end: idx + p.length });
      cursor = idx + p.length;
    }
    var out = [];
    var cur = null;
    paras.forEach(function (p) {
      if (!cur) { cur = { text: p.text, start: p.start, end: p.end }; return; }
      if ((cur.text + '\n\n' + p.text).length <= maxChars) {
        cur.text += '\n\n' + p.text;
        cur.end = p.end;
      } else {
        out.push(cur);
        cur = { text: p.text, start: p.start, end: p.end };
      }
    });
    if (cur) out.push(cur);
    return out;
  }

  root.VaultChat = root.VaultChat || {};
  root.VaultChat.Chunking = {
    chunkFixed: chunkFixed,
    chunkSentences: chunkSentences,
    chunkParagraphs: chunkParagraphs,
    splitSentences: splitSentences
  };
})(typeof window !== 'undefined' ? window : globalThis);
