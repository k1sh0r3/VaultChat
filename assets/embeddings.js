/* VaultChat — in-browser embeddings via transformers.js (ES module).
   Loads Xenova/all-MiniLM-L6-v2 (~90MB, cached by the browser after first run).
   Any failure → caller falls back to BM25 and says so honestly. */

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const CDN = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

let extractor = null;
let loadError = null;

export function embeddingsReady() { return !!extractor; }
export function embeddingsError() { return loadError; }

/* onProgress(phase, pct) — phase: 'downloading' | 'ready'. Never throws. */
export async function loadEmbeddings(onProgress) {
  if (extractor) { if (onProgress) onProgress('ready', 100); return true; }
  try {
    const { pipeline, env } = await import(CDN);
    // Keep everything remote-cached; never look for local model files.
    env.allowLocalModels = false;
    extractor = await pipeline('feature-extraction', MODEL_ID, {
      progress_callback: (p) => {
        if (!onProgress) return;
        if (p.status === 'progress' && p.total) {
          onProgress('downloading', Math.round((p.loaded / p.total) * 100));
        } else if (p.status === 'done' || p.status === 'ready') {
          onProgress('downloading', 100);
        }
      }
    });
    if (onProgress) onProgress('ready', 100);
    return true;
  } catch (e) {
    loadError = e && e.message ? e.message : String(e);
    extractor = null;
    return false;
  }
}

/* Returns array of plain number arrays, one per text. Throws on failure. */
export async function embed(texts) {
  if (!extractor) throw new Error('embeddings not loaded');
  const out = await extractor(texts, { pooling: 'mean', normalize: true });
  // out is a Tensor [n, dim]; convert rows to plain arrays.
  const data = out.data;
  const dim = out.dims[1];
  const n = out.dims[0];
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push(Array.from(data.slice(i * dim, (i + 1) * dim)));
  }
  return rows;
}
