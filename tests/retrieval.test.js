/* VaultChat tests — retrieval (cosine + BM25). Run: node --test tests/*.test.js */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

require('../assets/retrieval.js');
const R = globalThis.VaultChat.Retrieval;

describe('tokenize', () => {
  it('lowercases and strips punctuation', () => {
    assert.deepEqual(R.tokenize('Hello, WORLD! 123'), ['hello', 'world', '123']);
  });
  it('handles empty input', () => {
    assert.deepEqual(R.tokenize(''), []);
    assert.deepEqual(R.tokenize(null), []);
  });
});

describe('cosine', () => {
  it('is 1 for identical vectors', () => {
    assert.ok(Math.abs(R.cosine([1, 2, 3], [1, 2, 3]) - 1) < 1e-9);
  });
  it('is 0 for orthogonal vectors', () => {
    assert.ok(Math.abs(R.cosine([1, 0], [0, 1])) < 1e-9);
  });
  it('is -1 for opposite vectors', () => {
    assert.ok(Math.abs(R.cosine([1, 0], [-1, 0]) + 1) < 1e-9);
  });
  it('is 0 for zero vectors (no NaN)', () => {
    assert.equal(R.cosine([0, 0], [1, 2]), 0);
    assert.equal(R.cosine([], []), 0);
  });
  it('is scale invariant', () => {
    const a = R.cosine([1, 2], [2, 3]);
    const b = R.cosine([10, 20], [20, 30]);
    assert.ok(Math.abs(a - b) < 1e-9);
  });
});

describe('rankCosine + topK', () => {
  const items = [{ vec: [1, 0] }, { vec: [0.9, 0.1] }, { vec: [0, 1] }];

  it('ranks most similar first', () => {
    const ranked = R.rankCosine([1, 0], items);
    assert.deepEqual(ranked.map(r => r.index), [0, 1, 2]);
    assert.ok(ranked[0].score > ranked[1].score && ranked[1].score > ranked[2].score);
  });

  it('topK slices to k', () => {
    const ranked = R.rankCosine([1, 0], items);
    assert.equal(R.topK(ranked, 2).length, 2);
    assert.equal(R.topK(ranked, 99).length, 3);
  });

  it('handles items without vectors', () => {
    const ranked = R.rankCosine([1, 0], [{}, { vec: [1, 0] }]);
    assert.equal(ranked[0].index, 1);
  });
});

describe('BM25 fallback', () => {
  const docs = [
    'The vault stores encrypted documents locally in the browser',
    'Baking sourdough bread requires patience and a hot oven',
    'Local document search uses keyword scoring without embeddings'
  ];
  const idx = R.buildBm25(docs);

  it('ranks the document with the most query terms first', () => {
    const ranked = idx.score('local documents browser');
    assert.equal(ranked[0].index, 0);
  });

  it('prefers term frequency', () => {
    const idx2 = R.buildBm25(['cat cat cat', 'cat dog']);
    assert.equal(idx2.score('cat')[0].index, 0);
  });

  it('scores zero for no term overlap', () => {
    const ranked = idx.score('quantum zebras');
    assert.ok(ranked.every(r => r.score === 0));
  });

  it('idf downweights ubiquitous terms', () => {
    // "alpha" appears in every doc; only doc 0 has the rare term "beta".
    const idx2 = R.buildBm25(['alpha beta', 'alpha gamma', 'alpha delta']);
    const ranked = idx2.score('alpha beta');
    assert.equal(ranked[0].index, 0, 'rare term should decide the ranking');
    assert.ok(ranked[0].score > ranked[1].score * 2, 'ubiquitous term contributes little');
  });

  it('handles empty corpus', () => {
    const empty = R.buildBm25([]);
    assert.deepEqual(empty.score('anything'), []);
  });
});
