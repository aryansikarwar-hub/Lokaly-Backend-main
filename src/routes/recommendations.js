const express = require('express');
const axios = require('axios');
const router = express.Router();
const env = require('../config/env');
const logger = require('../utils/logger');

const RECO_API = env.recommendation.apiUrl;
const TIMEOUT = env.recommendation.timeout;

/**
 * Normalize HF response → always return an array of products to the frontend.
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
 * ✅ FIX: HF model ke paas images nahi hoti — MongoDB se real images attach karo
 * HF results mein _id hota hai → Product.find() se images, seller info fetch karo
 */
async function enrichWithImages(items) {
  if (!items || items.length === 0) return items;

  try {
    const Product = require('../models/Product');

    // Valid MongoDB ObjectIds nikalo
    const ids = items
      .map((p) => p._id || p.id)
      .filter(Boolean);

    if (ids.length === 0) return items;

    // Ek hi query mein sab products fetch karo — images aur seller info ke saath
    const dbProducts = await Product.find({ _id: { $in: ids } })
      .populate('seller', 'shopName isVerifiedSeller')
      .select('_id images seller title price rating reviewCount')
      .lean();

    // _id → product map banao quick lookup ke liye
    const dbMap = {};
    dbProducts.forEach((p) => {
      dbMap[String(p._id)] = p;
    });

    // HF results ko DB images se enrich karo
    return items.map((item) => {
      const itemId = String(item._id || item.id || '');
      const dbProduct = dbMap[itemId];

      if (!dbProduct) return item; // DB mein nahi mila — HF data as-is

      return {
        ...item,
        // ✅ Real images DB se — yahi fix hai
        image: dbProduct.images?.[0]?.url || item.image || '',
        images: dbProduct.images || [],
        // Seller info bhi DB se (zyada accurate)
        seller: dbProduct.seller || item.seller,
      };
    });
  } catch (err) {
    logger.warn('Image enrichment failed (non-fatal):', err.message);
    return items; // Fail gracefully — bina images ke bhi results dikhao
  }
}

/**
 * POST /api/recommendations/search
 */
router.post('/search', async (req, res) => {
  try {
    const { query, city } = req.body;
    if (!query || typeof query !== 'string' || query.trim() === '') {
      return res.status(400).json({ success: false, message: 'Query is required', results: [] });
    }

    const data = await callHF('/recommend', { query: query.trim(), city: city || null });
    const raw = normalize(data);

    // ✅ Images attach karo MongoDB se
    const results = await enrichWithImages(raw);

    return res.json({
      success: true,
      results,
      searched_product: data?.searched_product || null,
      product_found: !!data?.product_found,
    });
  } catch (err) {
    logger.warn('Recommendation search failed:', err.message);
    return res.json({ success: false, results: [], message: 'Search temporarily unavailable' });
  }
});

/**
 * GET /api/recommendations/for-you
 */
router.get('/for-you', async (req, res) => {
  try {
    const city = req.query.city || (req.user && req.user.city) || null;
    const interest = req.query.interest;

    let data;
    if (interest && String(interest).trim()) {
      data = await callHF('/recommend', { query: String(interest).trim(), city });
    } else {
      try {
        data = await callHFGet('/popular', { city, limit: 8 });
      } catch (e) {
        logger.warn('Popular endpoint unavailable, falling back to /recommend:', e.message);
        data = await callHF('/recommend', { query: 'saree', city });
      }
    }

    const raw = normalize(data);

    // ✅ Images attach karo MongoDB se
    const enriched = await enrichWithImages(raw);

    return res.json({ success: true, recommendations: enriched });
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
    const raw = normalize(data).filter(
      (item) => String(item._id || item.id || '') !== String(productId),
    );

    // ✅ Images attach karo MongoDB se
    const similar = await enrichWithImages(raw);

    return res.json({ success: true, similar });
  } catch (err) {
    logger.warn('Recommendation similar failed:', err.message);
    return res.json({ success: false, similar: [], message: 'Similar items temporarily unavailable' });
  }
});

module.exports = router;