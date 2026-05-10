const express = require('express');
const axios = require('axios');
const router = express.Router();
const env = require('../config/env');
const logger = require('../utils/logger');

const RECO_API = env.recommendation.apiUrl;
const TIMEOUT = env.recommendation.timeout;

/**
 * Normalize HF response → always return an array of products to the frontend.
 * HF returns { product_found, recommendations: [...], searched_product? } or { error }.
 */
function normalize(hfData) {
  if (!hfData || typeof hfData !== 'object') return [];
  if (Array.isArray(hfData)) return hfData;
  if (Array.isArray(hfData.recommendations)) return hfData.recommendations;
  return [];
}

async function callHF(path, body) {
  if (!RECO_API) throw new Error('Recommendation API URL not configured');
  const url = `${RECO_API.replace(/\/$/, '')}${path}`;
  const res = await axios.post(url, body, {
    timeout: TIMEOUT,
    headers: { 'Content-Type': 'application/json' },
  });
  return res.data;
}

async function callHFGet(path, params) {
  if (!RECO_API) throw new Error('Recommendation API URL not configured');
  const url = `${RECO_API.replace(/\/$/, '')}${path}`;
  const res = await axios.get(url, {
    params,
    timeout: TIMEOUT,
    headers: { 'Content-Type': 'application/json' },
  });
  return res.data;
}

/**
 * POST /api/recommendations/search
 * User-driven search query.
 * Returns: { success, results: Product[] }   (always an array — frontend-friendly)
 */
router.post('/search', async (req, res) => {
  try {
    const { query, city } = req.body;
    if (!query || typeof query !== 'string' || query.trim() === '') {
      return res.status(400).json({ success: false, message: 'Query is required', results: [] });
    }
    const data = await callHF('/recommend', { query: query.trim(), city: city || null });
    return res.json({
      success: true,
      results: normalize(data),
      searched_product: data?.searched_product || null,
      product_found: !!data?.product_found,
    });
  } catch (err) {
    logger.warn('Recommendation search failed:', err.message);
    return res.json({ success: false, results: [], message: 'Search temporarily unavailable' });
  }
});

/**
 * GET /api/recommendations/for-you?city=&interest=
 * Home rail. Uses /popular when no interest is given (semantic search returns
 * empty for generic queries like "popular local businesses"), otherwise /recommend.
 */
router.get('/for-you', async (req, res) => {
  try {
    const city = req.query.city || (req.user && req.user.city) || null;
    const interest = req.query.interest;

    let data;
    if (interest && String(interest).trim()) {
      data = await callHF('/recommend', { query: String(interest).trim(), city });
    } else {
      // /popular endpoint returns top-N without similarity threshold
      try {
        data = await callHFGet('/popular', { city, limit: 8 });
      } catch (e) {
        // Backwards compat: old HF deploys without /popular — fall back to a
        // common category that the corpus reliably has.
        logger.warn('Popular endpoint unavailable, falling back to /recommend:', e.message);
        data = await callHF('/recommend', { query: 'saree', city });
      }
    }

    return res.json({ success: true, recommendations: normalize(data) });
  } catch (err) {
    logger.warn('Recommendation for-you failed:', err.message);
    return res.json({
      success: false,
      recommendations: [],
      message: 'Recommendations temporarily unavailable',
    });
  }
});

/**
 * GET /api/recommendations/similar/:productId
 * Product detail page — similar items. Looks the product up locally,
 * then asks HF for similar items based on its category/title.
 */
router.get('/similar/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    const Product = require('../models/Product');
    const product = await Product.findById(productId).lean();

    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found', similar: [] });
    }

    const query = product.category || product.title || '';
    const city =
      (product.sellerLocation && product.sellerLocation.city) ||
      product.city_name ||
      product.city ||
      req.query.city ||
      null;

    if (!query) return res.json({ success: true, similar: [] });

    const data = await callHF('/recommend', { query, city });
    const list = normalize(data).filter(
      (item) => String(item._id || item.id || '') !== String(productId),
    );

    return res.json({ success: true, similar: list });
  } catch (err) {
    logger.warn('Recommendation similar failed:', err.message);
    return res.json({ success: false, similar: [], message: 'Similar items temporarily unavailable' });
  }
});

module.exports = router;
