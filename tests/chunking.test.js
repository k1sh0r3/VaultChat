/* VaultChat tests — chunking. Run: node --test tests/*.test.js */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

require('../assets/chunking.js');
const C = globalThis.VaultChat.Chunking;

describe('chunkFixed', () => {
  it('splits into fixed-size windows', () => {
    const chunks = C.chunkFixed('abcdefghij', { size: 4, overlap: 0 });
    assert.deepEqual(chunks.map(c => c.text), ['abcd', 'efgh', 'ij']);
  });

  it('applies overlap correctly', () => {
    const chunks = C.chunkFixed('abcdefghij', { size: 4, overlap: 2 });
    // trailing window adds no new content beyond the previous one, so it is dropped
    assert.deepEqual(chunks.map(c => c.text), ['abcd', 'cdef', 'efgh', 'ghij']);
  });

  it('tracks char offsets', () => {
    const chunks = C.chunkFixed('abcdefghij', { size: 4, overlap: 2 });
    assert.equal(chunks[1].start, 2);
    assert.equal(chunks[1].end, 6);
    assert.equal('abcdefghij'.slice(chunks[1].start, chunks[1].end), 'cdef');
  });

  it('handles empty and tiny input', () => {
    assert.deepEqual(C.chunkFixed('', { size: 512 }), []);
    assert.deepEqual(C.chunkFixed('   ', { size: 512 }), []);
    const one = C.chunkFixed('hi', { size: 512 });
    assert.equal(one.length, 1);
    assert.equal(one[0].text, 'hi');
  });

  it('clamps overlap below size', () => {
    const chunks = C.chunkFixed('abcdefgh', { size: 4, overlap: 99 });
    assert.ok(chunks.length > 1, 'must still advance');
    assert.equal(chunks[0].text, 'abcd');
  });

  it('reconstructs the source from non-overlapping chunks', () => {
    const text = 'The quick brown fox jumps over the lazy dog. '.repeat(20);
    const chunks = C.chunkFixed(text, { size: 256, overlap: 0 });
    assert.equal(chunks.map(c => c.text).join(''), text);
  });
});

describe('splitSentences', () => {
  it('splits on terminal punctuation', () => {
    const s = C.splitSentences('Hello world. How are you? Fine!');
    assert.equal(s.length, 3);
    assert.equal(s[0].text, 'Hello world.');
  });

  it('returns [] for empty input', () => {
    assert.deepEqual(C.splitSentences(''), []);
    assert.deepEqual(C.splitSentences(null), []);
  });
});

describe('chunkSentences', () => {
  const text = 'First sentence. Second sentence here. Third one now. Fourth arrives. Fifth and last.';

  it('windows sentences with overlap', () => {
    const chunks = C.chunkSentences(text, { window: 2, overlap: 1 });
    assert.equal(chunks.length, 4);
    assert.ok(chunks[0].text.includes('First sentence.'));
    assert.ok(chunks[0].text.includes('Second sentence here.'));
    assert.ok(chunks[1].text.includes('Second sentence here.'));
    assert.ok(chunks[1].text.includes('Third one now.'));
  });

  it('window larger than sentence count yields one chunk', () => {
    const chunks = C.chunkSentences('Only one. Two total.', { window: 5, overlap: 1 });
    assert.equal(chunks.length, 1);
  });

  it('keeps offsets consistent with the source', () => {
    const chunks = C.chunkSentences(text, { window: 2, overlap: 0 });
    chunks.forEach(c => {
      assert.ok(text.slice(c.start, c.end).includes(c.text.split('. ')[0].split('.')[0]));
    });
  });
});

describe('chunkParagraphs', () => {
  it('splits on blank lines', () => {
    const chunks = C.chunkParagraphs('Para one.\n\nPara two.\n\nPara three.', { maxChars: 15 });
    assert.equal(chunks.length, 3);
  });

  it('greedily merges small paragraphs up to maxChars', () => {
    const chunks = C.chunkParagraphs('aa\n\nbb\n\ncc', { maxChars: 10 });
    assert.equal(chunks.length, 1);
    assert.ok(chunks[0].text.includes('aa') && chunks[0].text.includes('cc'));
  });

  it('never merges beyond maxChars', () => {
    const chunks = C.chunkParagraphs('aaaa\n\nbbbb\n\ncccc', { maxChars: 9 });
    assert.equal(chunks.length, 3);
  });

  it('ignores empty input', () => {
    assert.deepEqual(C.chunkParagraphs('', {}), []);
    assert.deepEqual(C.chunkParagraphs('\n\n\n', {}), []);
  });
});
