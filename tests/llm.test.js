/* VaultChat tests — LLM adapters, citations, extractive fallback. Run: node --test tests/*.test.js */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

require('../assets/llm.js');
const L = globalThis.VaultChat.LLM;

function stubFetch(body, ok = true) {
  return async () => ({ ok, status: ok ? 200 : 401, json: async () => body });
}

describe('provider adapters', () => {
  it('openai builds a chat-completions request', () => {
    const req = L.PROVIDERS.openai.buildRequest('sk-x', 'sys', 'user');
    assert.ok(req.url.includes('api.openai.com/v1/chat/completions'));
    assert.equal(req.headers['Authorization'], 'Bearer sk-x');
    assert.equal(req.body.model, 'gpt-4o-mini');
    assert.equal(req.body.messages[1].content, 'user');
  });

  it('groq uses the OpenAI-compatible endpoint', () => {
    const req = L.PROVIDERS.groq.buildRequest('gsk-x', 's', 'u');
    assert.ok(req.url.includes('api.groq.com/openai/v1/chat/completions'));
    assert.equal(req.body.model, 'llama-3.3-70b-versatile');
  });

  it('gemini builds a generateContent request', () => {
    const req = L.PROVIDERS.gemini.buildRequest('AIza-x', 'sys', 'user');
    assert.ok(req.url.includes('generativelanguage.googleapis.com'));
    assert.ok(req.url.includes(encodeURIComponent('AIza-x')));
    assert.equal(req.body.contents[0].parts[0].text, 'user');
  });

  it('custom honors base URL + model and normalizes the path', () => {
    L.setCustomConfig({ baseUrl: 'https://openrouter.ai/api/v1/', model: 'deepseek/deepseek-chat' });
    const req = L.PROVIDERS.custom.buildRequest('k', 's', 'u');
    assert.equal(req.url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(req.body.model, 'deepseek/deepseek-chat');
    L.setCustomConfig({ baseUrl: 'http://localhost:11434/v1/chat/completions', model: 'llama3' });
    assert.equal(L.PROVIDERS.custom.buildRequest('k', 's', 'u').url,
      'http://localhost:11434/v1/chat/completions');
  });

  it('each provider parses its response shape', () => {
    const oa = { choices: [{ message: { content: 'hi' } }] };
    assert.equal(L.PROVIDERS.openai.parseResponse(oa), 'hi');
    assert.equal(L.PROVIDERS.groq.parseResponse(oa), 'hi');
    assert.equal(L.PROVIDERS.custom.parseResponse(oa), 'hi');
    assert.equal(
      L.PROVIDERS.gemini.parseResponse({ candidates: [{ content: { parts: [{ text: 'a' }, { text: 'b' }] } }] }),
      'ab');
    assert.equal(L.PROVIDERS.openai.parseResponse({}), null);
  });
});

describe('key store + custom config', () => {
  beforeEach(() => {
    L.setKey('openai', ''); L.setKey('custom', '');
    L.setCustomConfig({ baseUrl: '', model: '' });
  });

  it('stores and clears keys', () => {
    assert.equal(L.hasKey('openai'), false);
    L.setKey('openai', 'sk-test');
    assert.equal(L.getKey('openai'), 'sk-test');
    L.setKey('openai', '');
    assert.equal(L.hasKey('openai'), false);
  });

  it('customReady needs key + baseUrl + model', () => {
    assert.equal(L.customReady(), false);
    L.setKey('custom', 'k');
    assert.equal(L.customReady(), false);
    L.setCustomConfig({ baseUrl: 'https://x.test/v1', model: 'm' });
    assert.equal(L.customReady(), true);
  });
});

describe('chat()', () => {
  beforeEach(() => {
    L.setKey('openai', ''); L.setKey('custom', '');
    L.setCustomConfig({ baseUrl: '', model: '' });
  });

  it('returns null without provider/key (graceful)', async () => {
    assert.equal(await L.chat('s', 'u', { provider: 'openai' }), null);
    assert.equal(await L.chat('s', 'u', {}), null);
  });

  it('round-trips through stubbed fetch', async () => {
    L.setKey('openai', 'sk-test');
    const text = await L.chat('s', 'u', {
      provider: 'openai',
      fetchImpl: stubFetch({ choices: [{ message: { content: 'answer [1]' } }] })
    });
    assert.equal(text, 'answer [1]');
  });

  it('returns null on http error or network throw', async () => {
    L.setKey('groq', 'gsk-test');
    assert.equal(await L.chat('s', 'u', { provider: 'groq', fetchImpl: stubFetch({}, false) }), null);
    assert.equal(await L.chat('s', 'u', {
      provider: 'groq', fetchImpl: async () => { throw new Error('down'); }
    }), null);
  });

  it('custom provider gates on full config', async () => {
    L.setKey('custom', 'k');
    assert.equal(await L.chat('s', 'u', { provider: 'custom' }), null, 'no endpoint config');
    L.setCustomConfig({ baseUrl: 'https://x.test/v1', model: 'm' });
    const text = await L.chat('s', 'u', {
      provider: 'custom',
      fetchImpl: stubFetch({ choices: [{ message: { content: 'ok' } }] })
    });
    assert.equal(text, 'ok');
  });
});

describe('citations', () => {
  const chunks = [
    { n: 1, docName: 'Handbook', page: 2, chunkIndex: 4, text: 'PTO accrues monthly.' },
    { n: 2, docName: 'Memo', page: 1, chunkIndex: 0, text: 'Bees prefer clover.' }
  ];

  it('buildRagPrompt embeds numbered sources and the question', () => {
    const p = L.buildRagPrompt('How much PTO?', chunks);
    assert.ok(p.user.includes('[Source 1: Handbook, page 2]'));
    assert.ok(p.user.includes('Question: How much PTO?'));
    assert.ok(p.system.includes('[1]'));
  });

  it('formatCitation shows doc + page + chunk', () => {
    assert.equal(L.formatCitation(chunks[0]), '[1] Handbook (p.2, chunk 5)');
  });
});

describe('extractive fallback', () => {
  const ranked = [
    { chunk: { docName: 'Handbook', page: 2, chunkIndex: 4, text: 'PTO accrues monthly for full-time staff.' }, score: 0.9 }
  ];

  it('shows the no-key banner', () => {
    const ans = L.extractiveAnswer('pto policy', ranked);
    assert.ok(ans.banner.includes('No LLM key'));
  });

  it('highlights query terms', () => {
    const ans = L.extractiveAnswer('pto policy', ranked);
    assert.ok(ans.html.includes('<mark>PTO</mark>'), 'matched term wrapped in <mark>');
  });

  it('maps citations to chunks', () => {
    const ans = L.extractiveAnswer('pto', ranked);
    assert.deepEqual(ans.citations, [{ n: 1, docName: 'Handbook', page: 2, chunkIndex: 4 }]);
  });

  it('escapes HTML in source text', () => {
    const evil = [{ chunk: { docName: 'X', page: 1, chunkIndex: 0, text: '<script>alert(1)</script>' }, score: 1 }];
    const ans = L.extractiveAnswer('x', evil);
    assert.ok(!ans.html.includes('<script>'));
    assert.ok(ans.html.includes('&lt;script&gt;'));
  });
});
