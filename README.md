# VaultChat

**Your documents, interrogated privately.** A 100% in-browser RAG app: drop in PDFs or text files, chat with them. Parsing, chunking, embeddings, and retrieval all run on your device. No server, no uploads, no account.

## How to run

No build step. Serve the folder over HTTP (recommended) or open `index.html` directly:

```bash
cd vaultchat
python3 -m http.server 8080
# → http://localhost:8080
```

`file://` mostly works, but some browsers restrict module scripts/workers on `file://` URLs — if the embedding model won't load, use a static server or GitHub Pages. Deploy: push this folder to a repo and enable GitHub Pages.

## Privacy guarantees

- **Documents never leave your browser.** PDF parsing (pdf.js), chunking, embeddings (transformers.js), the IndexedDB vector store, and BM25 fallback all run locally.
- **The only network calls are:** CDN scripts/fonts, the one-time embedding-model download (~90MB, cached by the browser afterwards), and — only if you paste an API key — calls to *your chosen* LLM provider.
- **Keys live in `localStorage` only.** "Wipe everything" deletes documents, embeddings, keys, and the transcript.

## Features

- **Ingest:** drag-and-drop PDFs (per-page text via pdf.js), TXT/MD, plus 3 bundled fictional sample docs so it works instantly with zero uploads.
- **Chunking:** fixed-size + overlap (256/512/1024 chars), sentence window, or paragraph-based. Chunk counts shown per document.
- **Embeddings:** `Xenova/all-MiniLM-L6-v2` via transformers.js, with a download progress indicator. If it fails (offline, blocked CDN), the app **says so** and falls back to BM25 keyword retrieval — never silently fakes embeddings.
- **Retrieval:** cosine top-k over the IndexedDB vector store, adjustable k (1–10), per-document enable/disable toggles.
- **Chat:** with a BYOK key (OpenAI / Gemini / Groq / custom OpenAI-compatible endpoint) you get abstractive answers with inline `[1][2]` citations; without a key you get extractive mode — top passages with query-term highlighting and an honest banner.
- **Citations** always show document name + page + chunk. **Export** the transcript as Markdown.

## Honest limitations

- **First run downloads ~90MB** for the embedding model (then cached). Offline first-run = BM25 keyword mode.
- **Scanned/image PDFs won't parse** — pdf.js extracts embedded text only; there's no OCR.
- **Embeddings are mean-pooled MiniLM** — good for small personal corpora, not a production search engine. Very large documents (hundreds of pages) will be slow to embed in-browser.
- **BYOK keys are sent to the provider you choose** — that's the one deliberate exception to "nothing leaves the browser," and only when you opt in.
- Abstractive answers depend on the provider's model; the app instructs it to cite sources and admit when the answer isn't in them, but always check citations.

## Tests

```bash
node --test tests/*.test.js
```

54 tests, all green: chunking strategies (boundaries, overlap, merging), cosine/BM25 ranking, provider adapter request shapes, citation mapping, extractive fallback, and a no-key smoke test (ingest → BM25 → answer with citations). Browser-only modules (`store.js`, `embeddings.js`, `app.js`) are excluded from Node tests by design.

## Theme

**VAULT** — deep forest green + brass, a private-archive / bank-vault feel (Fraunces + Inter + IBM Plex Mono).
