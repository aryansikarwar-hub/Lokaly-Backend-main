const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { classifySentiment, embed } = require('../ml/pipelines');

const ABUSIVE_KEYWORDS = [
  'idiot', 'stupid', 'fuck', 'shit', 'bitch', 'cunt', 'scam', 'cheat',
  'bastard', 'asshole', 'bloody', 'motherfucker', 'slut', 'whore',
  'randi', 'chutiya', 'bhosdike', 'bhenchod', 'madarchod',
];

/**
 * sentimentOf — callable from other controllers.
 * Returns { label, score } with NEUTRAL fallback on failure.
 */
async function sentimentOf(text) {
  try {
    const out = await classifySentiment(text);
    return { label: out.label, score: out.score };
  } catch (err) {
    return { label: 'NEUTRAL', score: 0 };
  }
}

exports.sentiment = asyncHandler(async (req, res) => {
  const text = (req.query.text || req.body?.text || '').trim();
  if (!text) throw ApiError.badRequest('text required');
  const out = await sentimentOf(text);

  const lower = text.toLowerCase();
  const keywordHit = ABUSIVE_KEYWORDS.some((w) => lower.includes(w));
  const flagged = keywordHit || (out.label === 'NEGATIVE' && out.score > 0.95);

  res.json({ ...out, flagged, keywordHit });
});

exports.embed = asyncHandler(async (req, res) => {
  const text = (req.body?.text || req.query.text || '').trim();
  if (!text) throw ApiError.badRequest('text required');
  const vec = await embed(text);
  res.json({ dim: vec.length, vector: vec });
});

exports.search = asyncHandler(async (req, res) => {
  const query = (req.body?.query || req.query.query || '').trim();
  if (!query) throw ApiError.badRequest('query required');
  const topK = Math.min(30, parseInt(req.body?.topK || req.query.topK || 12, 10));
  const category = req.body?.category || req.query.category;
  const { semanticSearch } = require('../services/searchService');
  const results = await semanticSearch(query, { topK, category });
  res.json({
    query,
    hits: results.map(({ product, score }) => ({
      score,
      product: {
        _id: product._id, title: product.title, price: product.price,
        images: product.images, slug: product.slug, seller: product.seller,
        rating: product.rating, reviewCount: product.reviewCount, category: product.category,
      },
    })),
  });
});

exports.reindex = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') throw ApiError.forbidden();
  const { reindexAll } = require('../services/searchService');
  const count = await reindexAll();
  res.json({ ok: true, indexed: count });
});

exports.health = asyncHandler(async (_req, res) => {
  // Kick off model loads in the background so subsequent calls are fast.
  const { loadSentiment, loadEmbed } = require('../ml/pipelines');
  loadSentiment().catch(() => null);
  loadEmbed().catch(() => null);
  res.json({ ok: true, models: ['sentiment-distilbert', 'embed-MiniLM-L6-v2'] });
});

exports.sentimentOf = sentimentOf;
exports.ABUSIVE_KEYWORDS = ABUSIVE_KEYWORDS;
