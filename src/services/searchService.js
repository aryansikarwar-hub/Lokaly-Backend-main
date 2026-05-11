const Product = require('../models/Product');
const { embed, cosine } = require('../ml/pipelines');

/**
 * Ensure a product has an embedding cached. If stale (older than 14 days) or
 * missing, compute from title + description + tags and persist.
 */
async function ensureProductEmbedding(product) {
  const STALE_MS = 14 * 24 * 60 * 60 * 1000;
  const stale =
    !product.embeddingUpdatedAt ||
    Date.now() - product.embeddingUpdatedAt.getTime() > STALE_MS;
  if (product.embedding && product.embedding.length && !stale)
    return product.embedding;

  const text = [
    product.title,
    product.category,
    (product.tags || []).join(' '),
    (product.description || '').slice(0, 400),
  ]
    .filter(Boolean)
    .join('. ');

  const vec = await embed(text);
  await Product.updateOne(
    { _id: product._id },
    { embedding: vec, embeddingUpdatedAt: new Date() }
  );
  // Mutate in-place so caller's reference is also up-to-date
  product.embedding = vec;
  return vec;
}

async function reindexAll({ batchSize = 50 } = {}) {
  const cursor = Product.find({ isActive: true })
    .select('+embedding +embeddingUpdatedAt title description category tags')
    .cursor();
  let count = 0;
  for await (const p of cursor) {
    await ensureProductEmbedding(p);
    count += 1;
    if (count % batchSize === 0) console.log(`[search] indexed ${count}`);
  }
  return count;
}

/**
 * Semantic search — loads top-candidate products, embeds the query,
 * ranks by cosine similarity.
 *
 * FIX: Added MIN_SCORE threshold so completely unrelated products
 * (score ~0) are excluded from results instead of returning garbage.
 * Also always calls ensureProductEmbedding so products missing an
 * embedding get one on-the-fly instead of silently scoring 0.
 */
async function semanticSearch(
  query,
  { topK = 12, category, maxCandidates = 300, minScore = 0.25 } = {}
) {
  // FIX: embed query and catch model-not-ready errors explicitly
  let qVec;
  try {
    qVec = await embed(query);
  } catch (err) {
    console.error('[search] embed error:', err);
    throw Object.assign(new Error('ML model not ready'), { status: 503 });
  }

  const filter = { isActive: true };
  if (category) filter.category = category;

  const candidates = await Product.find(filter)
    .select(
      '+embedding +embeddingUpdatedAt title price category tags images description seller slug rating reviewCount'
    )
    .limit(maxCandidates);

  const scored = [];
  for (const p of candidates) {
    // FIX: always ensure embedding — on-the-fly for new/stale products
    const vec = await ensureProductEmbedding(p);

    // FIX: skip products whose embedding dimension mismatches (shouldn't
    // happen after reindex, but guards against corrupt docs)
    if (!vec || vec.length !== qVec.length) continue;

    const score = cosine(qVec, vec);

    // FIX: filter out low-relevance results
    if (score >= minScore) {
      scored.push({ product: p, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

module.exports = { ensureProductEmbedding, reindexAll, semanticSearch };