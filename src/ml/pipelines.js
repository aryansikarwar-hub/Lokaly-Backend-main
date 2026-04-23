/**
 * Lazy-load @xenova/transformers pipelines once per process. The first call
 * downloads model weights into ./model-cache (see .gitignore) and subsequent
 * calls reuse the in-memory pipeline.
 *
 * Models (all run locally, no API keys):
 *   sentiment   -> Xenova/distilbert-base-uncased-finetuned-sst-2-english
 *   embed       -> Xenova/all-MiniLM-L6-v2  (384-dim sentence embeddings)
 */

let _sentiment = null;
let _embed = null;
let _loading = { sentiment: null, embed: null };

function transformersEnvReady() {
  // Keep the process running even if ONNX runtime is slow to init on first call.
  process.env.TRANSFORMERS_CACHE = process.env.TRANSFORMERS_CACHE || './model-cache';
}

async function loadSentiment() {
  if (_sentiment) return _sentiment;
  if (_loading.sentiment) return _loading.sentiment;
  transformersEnvReady();
  _loading.sentiment = (async () => {
    const { pipeline } = await import('@xenova/transformers');
    _sentiment = await pipeline(
      'sentiment-analysis',
      'Xenova/distilbert-base-uncased-finetuned-sst-2-english'
    );
    return _sentiment;
  })();
  return _loading.sentiment;
}

async function loadEmbed() {
  if (_embed) return _embed;
  if (_loading.embed) return _loading.embed;
  transformersEnvReady();
  _loading.embed = (async () => {
    const { pipeline } = await import('@xenova/transformers');
    _embed = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    return _embed;
  })();
  return _loading.embed;
}

async function classifySentiment(text) {
  const pipe = await loadSentiment();
  const [out] = await pipe(String(text || '').slice(0, 512));
  // { label: 'POSITIVE'|'NEGATIVE', score: 0..1 }
  return out;
}

async function embed(text) {
  const pipe = await loadEmbed();
  const out = await pipe(String(text || '').slice(0, 512), { pooling: 'mean', normalize: true });
  return Array.from(out.data);
}

function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

module.exports = { loadSentiment, loadEmbed, classifySentiment, embed, cosine };
