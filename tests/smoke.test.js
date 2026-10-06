/* VaultChat — no-key smoke test: full pipeline with zero API keys and no
   embedding model (BM25 fallback), like a first-time offline user.
   Run: node --test tests/*.test.js */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

require('../assets/chunking.js');
require('../assets/retrieval.js');
require('../assets/llm.js');
const C = globalThis.VaultChat.Chunking;
const R = globalThis.VaultChat.Retrieval;
const L = globalThis.VaultChat.LLM;

/* Tiny stand-in for a bundled sample doc. */
const HANDBOOK = [
  'Meridian Labs Employee Handbook. Section 3: Time Off.',
  'Full-time employees accrue paid time off at a rate of 1.5 days per month.',
  'PTO requests for more than five consecutive days need manager approval two weeks in advance.',
  '',
  'Section 7: Remote Work.',
  'Employees may work remotely up to three days per week.',
  'All remote work requires a secure VPN connection; public Wi-Fi is prohibited for company systems.'
].join('\n\n');

const MEMO = [
  'Field Memo: Urban Pollinator Survey, June 2026.',
  'Volunteers counted 214 bees across 12 park sites over four weekends.',
  'Clover patches attracted the most bees, followed by lavender beds.',
  'Recommendation: plant clover in the north meadow next spring.'
].join('\n\n');

function ingest(name, text, strategy) {
  const chunks = strategy === 'paragraph'
    ? C.chunkParagraphs(text, { maxChars: 160 })
    : C.chunkFixed(text, { size: 200, overlap: 40 });
  return chunks.map((c, i) => ({
    docName: name, page: 1, chunkIndex: i, text: c.text, vec: null // no embeddings offline
  }));
}

function retrieve(query, allChunks, k, enabledDocs) {
  const scoped = allChunks.filter(c => enabledDocs.has(c.docName));
  const idx = R.buildBm25(scoped.map(c => c.text));
  return R.topK(idx.score(query), k)
    .filter(r => r.score > 0)
    .map(r => ({ chunk: scoped[r.index], score: r.score }));
}

describe('no-key smoke test', () => {
  const docs = [...ingest('Handbook', HANDBOOK, 'paragraph'), ...ingest('Memo', MEMO, 'paragraph')];
  const enabled = new Set(['Handbook', 'Memo']);

  it('ingests two docs into chunks', () => {
    assert.ok(docs.length >= 4, 'expected several chunks, got ' + docs.length);
    assert.ok(docs.every(c => c.text.trim().length > 0));
  });

  it('retrieves the right doc for a PTO question (BM25, no embeddings)', () => {
    const ranked = retrieve('How much PTO do full-time employees get?', docs, 3, enabled);
    assert.ok(ranked.length > 0);
    assert.equal(ranked[0].chunk.docName, 'Handbook');
    assert.ok(ranked[0].chunk.text.includes('1.5 days'));
  });

  it('retrieves the right doc for a bee question', () => {
    const ranked = retrieve('How many bees were counted?', docs, 3, enabled);
    assert.equal(ranked[0].chunk.docName, 'Memo');
    assert.ok(ranked[0].chunk.text.includes('214'));
  });

  it('extractive answer carries the no-key banner and citations', () => {
    const ranked = retrieve('PTO accrual rate', docs, 2, enabled);
    const ans = L.extractiveAnswer('PTO accrual rate', ranked);
    assert.ok(ans.banner.includes('No LLM key'));
    assert.equal(ans.citations.length, ranked.length);
    assert.ok(ans.citations.every(c => c.docName && c.page >= 1));
    assert.ok(ans.html.includes('[1]'));
  });

  it('per-doc toggles scope retrieval', () => {
    const handbookOnly = new Set(['Handbook']);
    const ranked = retrieve('bees clover meadow', docs, 3, handbookOnly);
    assert.ok(ranked.every(r => r.chunk.docName === 'Handbook'),
      'disabled docs must not appear in results');
  });

  it('adjustable k is respected', () => {
    const ranked = retrieve('employees', docs, 1, enabled);
    assert.ok(ranked.length <= 1);
  });

  it('citation labels map back to source chunks', () => {
    const ranked = retrieve('remote work VPN', docs, 2, enabled);
    const ans = L.extractiveAnswer('remote work VPN', ranked);
    ans.citations.forEach((cit, i) => {
      const label = L.formatCitation({ n: cit.n, docName: cit.docName, page: cit.page, chunkIndex: cit.chunkIndex });
      assert.ok(label.startsWith('[' + (i + 1) + ']'));
      assert.ok(label.includes(cit.docName));
    });
  });
});
