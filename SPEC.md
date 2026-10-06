# VaultChat — SPEC

**One-liner:** "Your documents, interrogated privately." A 100% in-browser RAG app: upload PDFs/TXT, chat with them. Parsing, chunking, embeddings, retrieval — all local. No server, no uploads, no account.

## Goals
- Working private RAG with zero setup: sample docs bundled so it answers questions immediately.
- Honest privacy: everything local; the only network calls are CDN scripts, the embedding-model download, and (optionally) the user's own BYOK LLM key.
- Graceful degradation: works fully without an LLM key (extractive answers) and without the embedding model (BM25 fallback) — and says so in the UI instead of faking it.

## Non-goals
- No multi-user, no sharing, no cloud sync. No OCR for scanned PDFs (pdf.js extracts embedded text only — stated honestly).

## Architecture (static, no build step)
```
index.html            — layout, CDN scripts (pdf.js UMD), module scripts
assets/style.css      — VAULT theme
assets/chunking.js    — classic script → globalThis.VaultChat.Chunking (Node-testable)
assets/retrieval.js   — cosine top-k + BM25 (Node-testable)
assets/llm.js         — BYOK provider adapters + extractive answers (Node-testable)
assets/store.js       — IndexedDB wrapper (browser only)
assets/sample-docs.js — 3 bundled sample texts (classic script)
assets/embeddings.js  — ES module: transformers.js pipeline, progress, fallback
assets/app.js         — ES module: UI wiring
tests/*.test.js       — node --test
```

## Features
1. **Ingest:** drag-and-drop multi-file; PDF via pdf.js CDN (per-page text), TXT/MD direct; per-doc page + chunk counts; 3 bundled sample docs (fictional handbook, research memo, founder letter).
2. **Chunking (configurable):** fixed-size w/ overlap (256/512/1024 chars), sentence-window (N sentences, overlap), paragraph-based (greedy merge ≤ maxChars).
3. **Embeddings:** transformers.js CDN, `Xenova/all-MiniLM-L6-v2` (~90MB, cached by browser). Progress bar on first load. On failure → BM25 mode with an honest banner.
4. **Vector store:** IndexedDB (`vaultchat` DB), per-doc records with chunk embeddings; cosine top-k, adjustable k (1–10); per-doc enable/disable toggles scoping retrieval.
5. **Chat:** retrieve → answer. BYOK (OpenAI / Gemini / Groq / custom OpenAI-compatible) → abstractive answer with inline [1][2] citations. No key → extractive mode with "no LLM key — showing source passages" banner + term highlighting. Citations always show doc name + page + chunk.
6. **Privacy UX:** persistent "100% local" badge, per-doc delete, "wipe everything" (IDB + keys), keys in localStorage only.
7. **Export:** chat transcript → Markdown download.

## Theme — VAULT (chosen 2026-10-05)
Deep forest green + brass, bank-vault / private-archive feel. Must not reuse: DOJO (dark slate/lime/coral), RED TEAM (near-black/crimson-magenta), AEGIS (deep navy/cyan-teal), DETONATION (charcoal/amber-gold), ATELIER (warm paper/emerald-gold), SWEEP (deep indigo/violet-fuchsia), BROADSHEET (cream/crimson serif), REWIND (purple-black/teal-purple).
- Palette: bg `#0b1510`, panel `#10231a`, brass `#c9a227` / bright `#e6c455`, parchment text `#eae2cc`, muted sage `#93a892`.
- Type: Fraunces (display serif) + Inter (body) + IBM Plex Mono (badges/meta) via Google Fonts.
- Motifs: engraved caps labels, double brass rules (banknote feel), "EST. 2026 · PRIVATE" stamps, vault-dial progress ring for model download.

## Engineering notes
- Cache-bust: `?v=N` on all local CSS/JS.
- `file://` limitation: ES modules + CDN imports generally work from file://, but some browsers restrict module workers; transformers.js model fetch needs network on first run. Honest README note: prefer `python3 -m http.server` or GitHub Pages.
- Tests: 40+ meaningful, all pure-logic (chunking, retrieval, llm, smoke). Browser-only modules (store, embeddings, app) excluded from Node tests by design.

## Acceptance
- `node --test tests/*.test.js` all green.
- No-key smoke test passes: sample doc → chunk → BM25 → extractive answer with citations.
- README documents privacy guarantees + honest limitations.
