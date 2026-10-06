/* VaultChat — UI wiring (ES module). */
import { loadEmbeddings, embed, embeddingsReady } from './embeddings.js?v=1';

const { Chunking, Retrieval, LLM, Store, SampleDocs } = window.VaultChat;
const $ = (id) => document.getElementById(id);

/* ---------- state ---------- */
const SETTINGS_KEY = 'vaultchat.settings';
const ENABLED_KEY = 'vaultchat.enabled';
const TRANSCRIPT_KEY = 'vaultchat.transcript';

const settings = Object.assign(
  { chunker: 'fixed', chunkSize: 512, k: 4, provider: 'none' },
  JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
);
let docs = [];                 // [{id,name,pages,chunks:[{text,page,chunkIndex,vec,docName,docId}]}]
let enabledDocs = new Set(JSON.parse(localStorage.getItem(ENABLED_KEY) || '[]'));
let transcript = JSON.parse(localStorage.getItem(TRANSCRIPT_KEY) || '[]');
let bm25Mode = true;           // honest indicator: true until embeddings proven working

function saveSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
function saveEnabled() { localStorage.setItem(ENABLED_KEY, JSON.stringify([...enabledDocs])); }
function saveTranscript() { localStorage.setItem(TRANSCRIPT_KEY, JSON.stringify(transcript)); }

/* ---------- chunking ---------- */
function chunkText(text, page) {
  let raw;
  if (settings.chunker === 'sentences') raw = Chunking.chunkSentences(text, { window: 3, overlap: 1 });
  else if (settings.chunker === 'paragraphs') raw = Chunking.chunkParagraphs(text, { maxChars: 1024 });
  else raw = Chunking.chunkFixed(text, { size: settings.chunkSize, overlap: Math.floor(settings.chunkSize / 10) });
  return raw.map((c, i) => ({ text: c.text, page, chunkIndex: i, vec: null }));
}

/* ---------- ingest ---------- */
async function extractPdf(file) {
  const buf = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
  const pages = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    pages.push(tc.items.map(it => it.str).join(' '));
  }
  return pages;
}

async function ingestFile(file) {
  const name = file.name;
  const isPdf = /\.pdf$/i.test(name);
  const pages = isPdf ? await extractPdf(file)
    : [await file.text()];
  let chunks = [];
  pages.forEach((t, pi) => {
    chunkText(t, pi + 1).forEach(c => chunks.push(c));
  });
  // embed (batched); on any failure keep vec:null → BM25 covers it
  if (embeddingsReady() && chunks.length) {
    try {
      for (let i = 0; i < chunks.length; i += 32) {
        const batch = chunks.slice(i, i + 32);
        const vecs = await embed(batch.map(c => c.text));
        batch.forEach((c, j) => { c.vec = vecs[j]; });
      }
    } catch (e) { chunks.forEach(c => { c.vec = null; }); }
  }
  const doc = {
    id: Store.newId(), name, addedAt: Date.now(),
    pages: pages.length, chunker: settings.chunker, chunks
  };
  chunks.forEach(c => { c.docName = name; c.docId = doc.id; });
  await Store.saveDoc(doc);
  docs.push(doc);
  enabledDocs.add(doc.id);
  saveEnabled();
  refreshRetrievalMode();
  renderDocs();
}

async function ingestSample(sample) {
  const chunks = chunkText(sample.text, 1);
  if (embeddingsReady() && chunks.length) {
    try {
      const vecs = await embed(chunks.map(c => c.text));
      chunks.forEach((c, j) => { c.vec = vecs[j]; });
    } catch (e) { /* BM25 covers */ }
  }
  const doc = {
    id: Store.newId(), name: sample.name, addedAt: Date.now(),
    pages: 1, chunker: settings.chunker, chunks
  };
  chunks.forEach(c => { c.docName = sample.name; c.docId = doc.id; });
  await Store.saveDoc(doc);
  docs.push(doc);
  enabledDocs.add(doc.id);
  saveEnabled();
  refreshRetrievalMode();
  renderDocs();
}

/* ---------- retrieval ---------- */
function refreshRetrievalMode() {
  const all = docs.flatMap(d => d.chunks);
  bm25Mode = !(embeddingsReady() && all.length > 0 && all.every(c => c.vec && c.vec.length));
  const pill = $('mode-pill');
  pill.textContent = bm25Mode ? 'keyword retrieval (BM25)' : 'semantic retrieval (embeddings)';
  pill.classList.toggle('warn', bm25Mode);
  const note = $('mode-note');
  note.hidden = !bm25Mode;
}

async function retrieve(query, k) {
  const scoped = [];
  docs.forEach(d => { if (enabledDocs.has(d.id)) d.chunks.forEach(c => scoped.push(c)); });
  if (!scoped.length) return [];
  let ranked;
  if (!bm25Mode) {
    try {
      const [qvec] = await embed([query]);
      ranked = Retrieval.rankCosine(qvec, scoped);
    } catch (e) {
      const idx = Retrieval.buildBm25(scoped.map(c => c.text));
      ranked = idx.score(query);
    }
  } else {
    const idx = Retrieval.buildBm25(scoped.map(c => c.text));
    ranked = idx.score(query);
  }
  return Retrieval.topK(ranked, k)
    .filter(r => r.score > 0)
    .map(r => ({ chunk: scoped[r.index], score: r.score }));
}

/* ---------- chat ---------- */
function providerReady() {
  const p = settings.provider;
  if (!p || p === 'none') return false;
  return p === 'custom' ? LLM.customReady() : LLM.hasKey(p);
}

function esc(s) { return LLM.escapeHtml(s); }

function renderTranscript() {
  const box = $('messages');
  box.innerHTML = '';
  transcript.forEach(m => {
    const div = document.createElement('div');
    div.className = 'msg ' + m.role;
    if (m.role === 'user') {
      div.innerHTML = '<p>' + esc(m.text) + '</p>';
    } else {
      let html = '';
      if (m.banner) html += '<div class="banner">' + esc(m.banner) + '</div>';
      html += '<div class="answer">' + m.html + '</div>';
      if (m.citations && m.citations.length) {
        html += '<div class="cites">' + m.citations.map(c =>
          '<span class="cite">' + esc(LLM.formatCitation(c)) + '</span>').join('') + '</div>';
      }
      if (m.note) html += '<div class="dim small">' + esc(m.note) + '</div>';
      div.innerHTML = html;
    }
    box.appendChild(div);
  });
  box.scrollTop = box.scrollHeight;
}

function pushMsg(m) { transcript.push(m); saveTranscript(); renderTranscript(); }

async function ask() {
  const input = $('q');
  const question = input.value.trim();
  if (!question) return;
  input.value = '';
  pushMsg({ role: 'user', text: question });
  const thinking = { role: 'assistant', html: '<p class="dim">Searching the vault…</p>', citations: [] };
  pushMsg(thinking);

  const ranked = await retrieve(question, settings.k);
  transcript.pop(); // remove the "searching" placeholder

  if (!ranked.length) {
    pushMsg({ role: 'assistant', html: '<p>No relevant passages found. Try different wording, or enable more documents.</p>', citations: [] });
    return;
  }

  const cited = ranked.map((r, i) => ({
    n: i + 1, docName: r.chunk.docName, page: r.chunk.page,
    chunkIndex: r.chunk.chunkIndex, text: r.chunk.text
  }));

  if (providerReady()) {
    const prompt = LLM.buildRagPrompt(question, cited);
    const text = await LLM.chat(prompt.system, prompt.user, { provider: settings.provider });
    if (text) {
      pushMsg({
        role: 'assistant',
        html: '<p>' + esc(text).replace(/\n\n/g, '</p><p>').replace(/\[(\d+)\]/g, '<span class="cite-ref">[$1]</span>') + '</p>',
        citations: cited.map(c => ({ n: c.n, docName: c.docName, page: c.page, chunkIndex: c.chunkIndex })),
        note: 'Answered by ' + LLM.PROVIDERS[settings.provider].label + ' — key never left this browser.'
      });
      return;
    }
    // LLM call failed → honest fallback
    const ex = LLM.extractiveAnswer(question, ranked);
    pushMsg({
      role: 'assistant', banner: ex.banner, html: ex.html, citations: ex.citations,
      note: 'The AI call failed, so here are the source passages instead. Nothing was sent anywhere unexpected.'
    });
    return;
  }

  const ex = LLM.extractiveAnswer(question, ranked);
  pushMsg({ role: 'assistant', banner: ex.banner, html: ex.html, citations: ex.citations });
}

/* ---------- export ---------- */
function exportMarkdown() {
  let md = '# VaultChat transcript\n\n';
  transcript.forEach(m => {
    if (m.role === 'user') { md += '## Q: ' + m.text + '\n\n'; }
    else {
      const tmp = document.createElement('div');
      tmp.innerHTML = m.html;
      md += tmp.textContent.trim().replace(/\n{3,}/g, '\n\n') + '\n\n';
      (m.citations || []).forEach(c => { md += '- ' + LLM.formatCitation(c) + '\n'; });
      md += '\n';
    }
  });
  const blob = new Blob([md], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'vaultchat-transcript.md';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ---------- render: docs ---------- */
function renderDocs() {
  const list = $('doc-list');
  list.innerHTML = '';
  if (!docs.length) {
    list.innerHTML = '<p class="dim small">No documents yet — drop files above or load a sample.</p>';
  }
  docs.forEach(d => {
    const row = document.createElement('div');
    row.className = 'doc-row';
    const on = enabledDocs.has(d.id);
    row.innerHTML =
      '<label class="doc-toggle"><input type="checkbox" ' + (on ? 'checked' : '') + ' data-id="' + d.id + '"></label>' +
      '<div class="doc-meta"><div class="doc-name">' + esc(d.name) + '</div>' +
      '<div class="doc-sub dim small">' + d.pages + ' page' + (d.pages === 1 ? '' : 's') + ' · ' +
      d.chunks.length + ' chunks' + (d.chunks.some(c => c.vec) ? ' · embedded' : '') + '</div></div>' +
      '<button class="icon-btn" data-del="' + d.id + '" title="Delete document">×</button>';
    list.appendChild(row);
  });
  list.querySelectorAll('[data-id]').forEach(cb => cb.addEventListener('change', e => {
    const id = e.target.getAttribute('data-id');
    if (e.target.checked) enabledDocs.add(id); else enabledDocs.delete(id);
    saveEnabled();
  }));
  list.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', async e => {
    const id = e.target.getAttribute('data-del');
    await Store.deleteDoc(id);
    docs = docs.filter(d => d.id !== id);
    enabledDocs.delete(id);
    saveEnabled();
    refreshRetrievalMode();
    renderDocs();
  }));
  $('doc-count').textContent = docs.length;
}

/* ---------- settings UI ---------- */
function initSettings() {
  $('chunker').value = settings.chunker;
  $('chunk-size').value = String(settings.chunkSize);
  $('k').value = String(settings.k);
  $('k-val').textContent = settings.k;
  $('provider').value = settings.provider;
  toggleCustom(settings.provider === 'custom');
  toggleChunkSize();

  $('chunker').addEventListener('change', e => { settings.chunker = e.target.value; saveSettings(); toggleChunkSize(); noteRechunk(); });
  $('chunk-size').addEventListener('change', e => { settings.chunkSize = parseInt(e.target.value, 10); saveSettings(); noteRechunk(); });
  $('k').addEventListener('input', e => { settings.k = parseInt(e.target.value, 10); saveSettings(); $('k-val').textContent = settings.k; });
  $('provider').addEventListener('change', e => {
    settings.provider = e.target.value; saveSettings();
    toggleCustom(settings.provider === 'custom');
    refreshKeyUI();
  });
  $('btn-key-save').addEventListener('click', () => {
    const p = settings.provider;
    if (!p || p === 'none') return;
    const key = $('api-key').value.trim();
    if (!key) { setStatus('Paste a key first.', true); return; }
    if (p === 'custom') {
      const baseUrl = $('custom-base').value.trim();
      const model = $('custom-model').value.trim();
      if (!baseUrl || !model) { setStatus('Custom needs a base URL and a model name.', true); return; }
      LLM.setCustomConfig({ baseUrl, model });
    }
    LLM.setKey(p, key);
    $('api-key').value = '';
    refreshKeyUI();
    setStatus(LLM.PROVIDERS[p].label + ' saved — key lives in this browser only.');
  });
  $('btn-key-clear').addEventListener('click', () => {
    const p = settings.provider;
    if (p && p !== 'none') LLM.setKey(p, '');
    refreshKeyUI();
    setStatus('Key cleared.');
  });
  refreshKeyUI();
}

function toggleCustom(show) { $('custom-fields').hidden = !show; }
function toggleChunkSize() { $('chunk-size-row').style.display = settings.chunker === 'fixed' ? '' : 'none'; }
function noteRechunk() { setStatus('Chunking settings apply to newly added documents.'); }

function refreshKeyUI() {
  const p = settings.provider;
  const ready = providerReady();
  $('key-status').textContent =
    !p || p === 'none' ? 'No AI provider — extractive mode (source passages, no generated answer).'
    : ready ? LLM.PROVIDERS[p].label + ' ready — abstractive answers with citations.'
    : p === 'custom' ? 'Custom needs a key, base URL, and model name.'
    : 'No key saved for ' + LLM.PROVIDERS[p].label + '.';
}

function setStatus(msg, isErr) {
  const el = $('status');
  el.textContent = msg;
  el.classList.toggle('err', !!isErr);
  clearTimeout(setStatus._t);
  setStatus._t = setTimeout(() => { el.textContent = ''; }, 6000);
}

/* ---------- embeddings boot ---------- */
async function bootEmbeddings() {
  const pill = $('model-pill');
  pill.textContent = 'loading embedding model…';
  const ok = await loadEmbeddings((phase, pct) => {
    if (phase === 'downloading') {
      pill.textContent = 'downloading embedding model… ' + pct + '%';
      $('model-bar').style.width = pct + '%';
      $('model-progress').hidden = false;
    }
  });
  $('model-progress').hidden = true;
  if (ok) {
    pill.textContent = 'embeddings ready (MiniLM-L6-v2)';
    pill.classList.add('ok');
    // (re-)embed existing chunks that lack vectors
    for (const d of docs) {
      const missing = d.chunks.filter(c => !c.vec);
      if (!missing.length) continue;
      try {
        for (let i = 0; i < missing.length; i += 32) {
          const batch = missing.slice(i, i + 32);
          const vecs = await embed(batch.map(c => c.text));
          batch.forEach((c, j) => { c.vec = vecs[j]; });
        }
        await Store.saveDoc(d);
      } catch (e) { /* stay in BM25 for these */ }
    }
  } else {
    pill.textContent = 'embeddings unavailable — keyword mode';
    pill.classList.add('warn');
  }
  refreshRetrievalMode();
}

/* ---------- init ---------- */
async function init() {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  initSettings();
  docs = await Store.listDocs();
  docs.forEach(d => d.chunks.forEach(c => { c.docName = d.name; c.docId = d.id; }));
  // default: enable everything on first run
  if (!localStorage.getItem(ENABLED_KEY)) {
    docs.forEach(d => enabledDocs.add(d.id));
    saveEnabled();
  }
  renderDocs();
  renderTranscript();
  refreshRetrievalMode();

  const dz = $('dropzone');
  const input = $('file-input');
  dz.addEventListener('click', () => input.click());
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', async e => {
    e.preventDefault(); dz.classList.remove('over');
    await addFiles(e.dataTransfer.files);
  });
  input.addEventListener('change', async e => { await addFiles(e.target.files); input.value = ''; });

  $('sample-list').querySelectorAll('button').forEach((b, i) => {
    b.addEventListener('click', async () => {
      b.disabled = true;
      try { await ingestSample(SampleDocs[i]); setStatus('Sample loaded: ' + SampleDocs[i].name); }
      catch (e) { setStatus('Could not load sample.', true); }
      b.disabled = false;
    });
  });

  $('ask').addEventListener('click', ask);
  $('q').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } });
  $('btn-export').addEventListener('click', exportMarkdown);
  $('btn-wipe').addEventListener('click', async () => {
    if (!confirm('Wipe everything? This deletes all documents, embeddings, keys, and the transcript from this browser.')) return;
    await Store.clearAll();
    Object.keys(localStorage).filter(k => k.startsWith('vaultchat.')).forEach(k => localStorage.removeItem(k));
    docs = []; transcript = []; enabledDocs = new Set();
    renderDocs(); renderTranscript(); refreshRetrievalMode();
    setStatus('Vault wiped clean.');
  });

  bootEmbeddings(); // background; BM25 covers the meantime
}

async function addFiles(files) {
  for (const f of files) {
    if (!/\.(pdf|txt|md|markdown)$/i.test(f.name)) { setStatus('Skipped ' + f.name + ' — PDF, TXT, or MD only.', true); continue; }
    try { await ingestFile(f); setStatus('Added: ' + f.name); }
    catch (e) { setStatus('Could not read ' + f.name + '.', true); }
  }
}

document.addEventListener('DOMContentLoaded', init);
