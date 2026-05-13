/**
 * POST /api/voice/parse
 *
 * Body: { query: string }
 * Returns: {
 *   intent: { action, keywords, color, size, budget_max, location, urgency, quantity, spoken_response },
 *   results: [...]   // products if action=search and intent has keywords
 * }
 *
 * One round-trip from the frontend: STT → parse → fetched products. The
 * frontend then plays back `intent.spoken_response` via Web Speech Synthesis
 * and shows the products / cart action UI accordingly.
 */
const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const logger = require('../utils/logger');
const { parseIntent } = require('../services/voiceIntent');
const Product = require('../models/Product');

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Run a Mongo search using the structured intent fields.
 * Same heuristics as /recommendations/search localFallback, but driven by
 * the parsed budget / color / location / keywords.
 */
async function searchByIntent(intent, limit = 12) {
  const { keywords, color, budget_max, location, category } = intent;
  if (!keywords || keywords.length === 0) return [];

  const allTerms = [
    ...keywords,
    ...(color ? [color] : []),
    ...(category ? [category] : []),
  ];
  const regexes = allTerms.map((t) => new RegExp(escapeRegex(t), 'i'));

  const matchClause = {
    isActive: true,
    $or: [
      { title: { $in: regexes } },
      { description: { $in: regexes } },
      { category: { $in: regexes } },
      { tags: { $in: regexes } },
      { slug: { $in: regexes } },
    ],
  };
  if (budget_max && budget_max > 0) matchClause.price = { $lte: budget_max };
  if (location) {
    matchClause['sellerLocation.city'] = new RegExp(escapeRegex(location), 'i');
  }

  const products = await Product.find(matchClause)
    .populate('seller', 'shopName isVerifiedSeller')
    .select('_id title price images seller rating reviewCount category description slug sellerLocation')
    .limit(limit * 3)
    .lean();

  // Rank by keyword hit count, with location/color bonuses
  return products
    .map((p) => {
      const hay = `${p.title} ${p.description || ''} ${p.category || ''} ${(p.tags || []).join(' ')} ${p.slug || ''}`.toLowerCase();
      const hits = allTerms.filter((t) => hay.includes(String(t).toLowerCase())).length;
      const titleHits = allTerms.filter((t) => p.title.toLowerCase().includes(String(t).toLowerCase())).length;
      const cityMatch = location && p.sellerLocation?.city
        ? p.sellerLocation.city.toLowerCase().includes(location.toLowerCase()) ? 3 : 0
        : 0;
      return { product: p, score: hits + titleHits * 2 + cityMatch };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ product, score }) => ({
      _id: String(product._id),
      title: product.title,
      price: product.price,
      image: product.images?.[0]?.url || '',
      images: product.images || [],
      seller: product.seller,
      category: product.category,
      slug: product.slug,
      city: product.sellerLocation?.city,
      match_score: Math.min(100, score * 12),
    }));
}

router.post('/parse', async (req, res) => {
  const query = String(req.body?.query || '').trim();
  if (!query) {
    return res.status(400).json({ error: 'query required' });
  }
  try {
    const intent = await parseIntent(query);
    if (!intent) {
      return res.json({
        intent: null,
        results: [],
      });
    }

    let results = [];
    if (intent.action === 'search') {
      results = await searchByIntent(intent);
      // If no hits and we had a budget, retry without budget (so we always
      // surface at least something — UX over strict filtering).
      if (results.length === 0 && intent.budget_max) {
        results = await searchByIntent({ ...intent, budget_max: null });
      }
    }

    return res.json({ intent, results });
  } catch (err) {
    logger.warn('voice/parse failed:', err.message);
    return res.status(500).json({ error: 'voice parse failed', message: err.message });
  }
});

module.exports = router;
