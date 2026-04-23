const Product = require('../models/Product');
const { embed, cosine } = require('../ml/pipelines');

/**
 * Ensure a product has an embedding cached. If stale (older than 14 days) or
 * missing, compute from title + description + tags and persist.
 */
async function ensureProductEmbedding(product) {
  const STALE_MS = 14 * 24 * 60 * 60 * 1000;
  const stale = !product.embeddingUpdatedAt || (Date.now() - product.embeddingUpdatedAt.getTime()) > STALE_MS;
  if (product.embedding && product.embedding.length && !stale) return product.embedding;

  const text = [
    product.title,
    product.category,
    (product.tags || []).join(' '),
    (product.description || '').slice(0, 400),
  ].filter(Boolean).join('. ');

  const vec = await embed(text);
  await Product.updateOne(
    { _id: product._id },
    { embedding: vec, embeddingUpdatedAt: new Date() }
  );
  return vec;
}

async function reindexAll({ batchSize = 50 } = {}) {
  const cursor = Product.find({ isActive: true }).select('+embedding +embeddingUpdatedAt title description category tags').cursor();
  let count = 0;
  for await (const p of cursor) {
    await ensureProductEmbedding(p);
    count += 1;
    if (count % batchSize === 0) console.log(`[search] indexed ${count}`);
  }
  return count;
}

/**
 * Semantic search — loads top-candidate products (lexically filtered if q provided),
 * embeds the query, ranks by cosine similarity.
 */
async function semanticSearch(query, { topK = 12, category, maxCandidates = 300 } = {}) {
  const qVec = await embed(query);

  const filter = { isActive: true };
  if (category) filter.category = category;

  // Pull candidate window; for large catalogs we'd lean on a lexical prefilter or a vector DB.
  const candidates = await Product.find(filter)
    .select('+embedding +embeddingUpdatedAt title price category tags images description seller slug rating reviewCount')
    .limit(maxCandidates);

  const scored = [];
  for (const p of candidates) {
    const vec = (p.embedding && p.embedding.length) ? p.embedding : await ensureProductEmbedding(p);
    const score = cosine(qVec, vec);
    scored.push({ product: p, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

module.exports = { ensureProductEmbedding, reindexAll, semanticSearch };
