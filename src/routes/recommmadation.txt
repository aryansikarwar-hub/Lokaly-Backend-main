const express = require('express');
const axios = require('axios');
const router = express.Router();
const env = require('../config/env');
const logger = require('../utils/logger');

const RECO_API = env.recommendation.apiUrl;
const TIMEOUT = env.recommendation.timeout;

/**
 * Helper - HuggingFace recommendation API ko call karta hai
 */
async function fetchRecommendations(query, city) {
  if (!RECO_API) {
    throw new Error('Recommendation API URL not configured');
  }

  const response = await axios.post(
    `${RECO_API}/recommend`,
    { query, city },
    {
      timeout: TIMEOUT,
      headers: { 'Content-Type': 'application/json' },
    }
  );
  return response.data;
}

/**
 * POST /api/recommendations/search
 * User-driven search query
 */
router.post('/search', async (req, res) => {
  try {
    const { query, city } = req.body;

    if (!query || typeof query !== 'string' || query.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Query is required',
      });
    }

    const results = await fetchRecommendations(query.trim(), city || null);
    return res.json({ success: true, results });
  } catch (err) {
    logger.warn('Recommendation search failed:', err.message);
    return res.json({
      success: false,
      results: [],
      message: 'Search temporarily unavailable',
    });
  }
});

/**
 * GET /api/recommendations/for-you
 * Home page - personalized recommendations
 * Query params: city, interest
 */
router.get('/for-you', async (req, res) => {
  try {
    const city = req.query.city || (req.user && req.user.city) || null;
    const query = req.query.interest || 'popular local businesses';

    const results = await fetchRecommendations(query, city);
    return res.json({ success: true, recommendations: results });
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
 * Product detail page - similar items
 */
router.get('/similar/:productId', async (req, res) => {
  try {
    const { productId } = req.params;

    // Apne database se product fetch karke uska name/category extract karo
    // ⚠️ Path adjust karna agar tumhara model alag jagah hai
    const Product = require('../models/Product');
    const product = await Product.findById(productId).lean();

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
      });
    }

    const query = product.category || product.name || '';
    const city = product.city || req.query.city || null;

    if (!query) {
      return res.json({ success: true, similar: [] });
    }

    const results = await fetchRecommendations(query, city);

    // Khud product ko similar list se nikal do
    const filtered = Array.isArray(results)
      ? results.filter((item) => String(item.id) !== String(productId))
      : [];

    return res.json({ success: true, similar: filtered });
  } catch (err) {
    logger.warn('Recommendation similar failed:', err.message);
    return res.json({
      success: false,
      similar: [],
      message: 'Similar items temporarily unavailable',
    });
  }
});

module.exports = router;