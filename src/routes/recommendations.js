const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const router = express.Router();
const env = require('../config/env');
const logger = require('../utils/logger');
const queryEnricher = require('../services/queryEnricher');

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

const PRODUCT_SELECT =
  '_id title price images seller rating reviewCount category description slug';

function shapeFromDB(item, dbProduct) {
  return {
    ...(item || {}),
    _id: String(dbProduct._id),
    title: dbProduct.title,
    price: typeof dbProduct.price === 'number' ? dbProduct.price : item?.price,
    image: dbProduct.images?.[0]?.url || item?.image || '',
    images: dbProduct.images || [],
    seller: dbProduct.seller,
    category: dbProduct.category || item?.category,
    slug: dbProduct.slug,
    rating: dbProduct.rating,
    reviewCount: dbProduct.reviewCount,
    match_score: item?.match_score,
  };
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * HF kabhi _id deta hai, kabhi sirf title. Pehle ObjectId match, fir
 * exact/regex title match. Jo DB mein mile bas wahi return — taaki har
 * card click pe valid product page khule.
 */
async function enrichWithImages(items) {
  if (!items || items.length === 0) return [];
  try {
    const Product = require('../models/Product');

    const validIds = items
      .map((p) => String(p._id || p.id || ''))
      .filter((id) => mongoose.Types.ObjectId.isValid(id));
    const titles = items.map((p) => String(p.title || '').trim()).filter(Boolean);

    const [byId, byTitle] = await Promise.all([
      validIds.length
        ? Product.find({ _id: { $in: validIds } })
            .populate('seller', 'shopName isVerifiedSeller')
            .select(PRODUCT_SELECT)
            .lean()
        : Promise.resolve([]),
      titles.length
        ? Product.find({
            isActive: true,
            title: { $in: titles.map((t) => new RegExp(`^${escapeRegex(t)}$`, 'i')) },
          })
            .populate('seller', 'shopName isVerifiedSeller')
            .select(PRODUCT_SELECT)
            .lean()
        : Promise.resolve([]),
    ]);

    const idMap = {};
    byId.forEach((p) => {
      idMap[String(p._id)] = p;
    });
    const titleMap = {};
    byTitle.forEach((p) => {
      const k = p.title.toLowerCase().trim();
      if (!titleMap[k]) titleMap[k] = p;
    });

    return items
      .map((item) => {
        const itemId = String(item._id || item.id || '');
        const byIdMatch = mongoose.Types.ObjectId.isValid(itemId) ? idMap[itemId] : null;
        const byTitleMatch = !byIdMatch && item.title
          ? titleMap[String(item.title).toLowerCase().trim()]
          : null;
        const db = byIdMatch || byTitleMatch;
        if (!db) return null;
        return shapeFromDB(item, db);
      })
      .filter(Boolean);
  } catch (err) {
    logger.warn('Image enrichment failed (non-fatal):', err.message);
    return [];
  }
}

// Hinglish/Hindi → English synonyms — agar Gemini key nahi hai to bhi
// common product names samajhne mein madad karta hai.
const HINDI_SYNONYMS = {
  haldi: ['turmeric', 'haldi'],
  chai: ['tea', 'chai'],
  kapda: ['cloth', 'fabric', 'kurta', 'saree'],
  kapde: ['cloth', 'fabric', 'kurta', 'saree'],
  mithai: ['sweets', 'kaju katli', 'mithai'],
  mithaai: ['sweets', 'mithai'],
  masala: ['spice', 'masala', 'garam masala'],
  chawal: ['rice', 'basmati'],
  chaval: ['rice', 'basmati'],
  achaar: ['pickle', 'achar', 'mango pickle'],
  achar: ['pickle', 'mango pickle'],
  aam: ['mango'],
  payal: ['anklet', 'payal'],
  jhumka: ['jhumka', 'earrings'],
  juta: ['footwear', 'jutti', 'mojari'],
  jute: ['footwear', 'jutti'],
  chappal: ['kolhapuri', 'footwear', 'chappal'],
  jewellery: ['jewelry', 'necklace', 'kundan'],
  jewelery: ['jewelry'],
  zewar: ['jewelry', 'necklace'],
  bartan: ['kitchen', 'utensil', 'brass', 'copper'],
  matka: ['terracotta', 'pot', 'matka'],
  diya: ['diya', 'pooja', 'diwali'],
  rangoli: ['rangoli', 'diwali'],
  tshirt: ['t-shirt', 'tshirt', 'kurta'],
  't-shirt': ['t-shirt', 'tshirt', 'kurta'],
  shirt: ['shirt', 'kurta'],
  shoes: ['footwear', 'jutti', 'kolhapuri', 'mojari'],
  bag: ['bag', 'tote', 'sling', 'clutch'],
  earring: ['earrings', 'jhumka'],
  earrings: ['earrings', 'jhumka'],
  pooja: ['pooja', 'diya', 'brass', 'thali'],
  puja: ['pooja', 'diya', 'brass'],
  bridal: ['bridal', 'lehenga', 'sherwani', 'jewelry'],
  shaadi: ['wedding', 'bridal', 'lehenga', 'sherwani'],
  wedding: ['wedding', 'bridal', 'lehenga'],
  diwali: ['diwali', 'diya', 'rangoli', 'pooja'],
  holi: ['holi', 'gulal'],
};

function expandQueryTerms(query) {
  const lower = String(query).toLowerCase();
  const raw = lower
    .split(/[\s\-_,.;:!?]+/)
    .map((t) => t.trim())
    // Keep short numerics (model numbers like "17", "S24") — they help
    // disambiguate "iPhone 17" from "iPhone 14". Drop only single chars.
    .filter((t) => t.length >= 2);

  const stopwords = new Set([
    'the', 'and', 'for', 'under', 'with', 'from', 'into', 'over', 'best', 'cheap',
    'mujhe', 'chahiye', 'hai', 'ka', 'ke', 'ki', 'me', 'mein', 'se', 'ko',
    'aur', 'bhi', 'kya', 'koi', 'kuch', 'wala', 'wali', 'wale',
  ]);
  const filtered = raw.filter((t) => !stopwords.has(t));

  // Hindi/Hinglish synonyms expand karo
  const expanded = new Set(filtered);
  for (const t of filtered) {
    const syn = HINDI_SYNONYMS[t];
    if (syn) syn.forEach((s) => expanded.add(s.toLowerCase()));
  }
  return Array.from(expanded).slice(0, 12);
}

/**
 * HF se kuch nahi mila to local Mongo pe regex search.
 * Order of preference for query understanding:
 *   1. Gemini (if GEMINI_API_KEY set) — best NLU, handles long queries.
 *   2. Built-in Hindi→English synonym map — handles common product names.
 *   3. Raw tokenization — last resort.
 */
async function localFallbackSearch(query, { limit = 8 } = {}) {
  try {
    const Product = require('../models/Product');

    let terms = expandQueryTerms(query);
    let categoryHint = null;

    // Agar Gemini available hai to query ko enrich karo — keywords + category
    if (queryEnricher.isEnabled()) {
      const enriched = await queryEnricher.enrichQuery(query);
      if (enriched && enriched.keywords.length > 0) {
        const enrichedSet = new Set(terms);
        enriched.keywords.forEach((k) => enrichedSet.add(String(k).toLowerCase()));
        terms = Array.from(enrichedSet).slice(0, 15);
        categoryHint = enriched.category || null;
      }
    }

    if (terms.length === 0) return [];
    const regexes = terms.map((t) => new RegExp(escapeRegex(t), 'i'));
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
    if (categoryHint) {
      matchClause.$or.push({ category: new RegExp(escapeRegex(categoryHint), 'i') });
    }

    const products = await Product.find(matchClause)
      .populate('seller', 'shopName isVerifiedSeller')
      .select(PRODUCT_SELECT)
      .limit(limit * 4)
      .lean();

    const scored = products
      .map((p) => {
        const hay = `${p.title} ${p.description || ''} ${p.category || ''} ${(p.tags || []).join(' ')} ${p.slug || ''}`.toLowerCase();
        const hits = terms.filter((t) => hay.includes(t)).length;
        const titleHits = terms.filter((t) => p.title.toLowerCase().includes(t)).length;
        const categoryBoost = categoryHint && p.category && p.category.toLowerCase().includes(categoryHint.toLowerCase()) ? 3 : 0;
        return { product: p, hits, score: hits + titleHits * 2 + categoryBoost };
      })
      .filter((x) => x.hits > 0 || (categoryHint && x.score > 0))
      .sort((a, b) => b.score - a.score);

    let primary = scored
      .slice(0, limit)
      .map(({ product, hits }) =>
        shapeFromDB({ match_score: Math.min(100, Math.round((hits / terms.length) * 100)) }, product),
      );

    // Category-sibling padding: if we got 1-3 hits, fetch more from the same
    // categories so the user sees a richer comparison set. Common case: "iPhone
    // 17" matches 1 product, but the buyer also wants to see iPhone 16 / Galaxy
    // / other phones in the Electronics category.
    if (primary.length > 0 && primary.length < 4) {
      const seen = new Set(primary.map((p) => String(p._id)));
      const cats = Array.from(
        new Set(
          scored
            .slice(0, 3)
            .map((s) => s.product.category)
            .filter(Boolean),
        ),
      );
      if (cats.length > 0) {
        const siblings = await Product.find({
          isActive: true,
          category: { $in: cats.map((c) => new RegExp(`^${escapeRegex(c)}$`, 'i')) },
          _id: { $nin: Array.from(seen) },
        })
          .populate('seller', 'shopName isVerifiedSeller')
          .select(PRODUCT_SELECT)
          .sort({ rating: -1, salesCount: -1, createdAt: -1 })
          .limit(limit - primary.length)
          .lean();
        const padded = siblings.map((p) =>
          shapeFromDB({ match_score: 60 }, p),
        );
        primary = primary.concat(padded);
      }
    }

    return primary;
  } catch (err) {
    logger.warn('Local fallback search failed:', err.message);
    return [];
  }
}

async function nearestProduct() {
  // Last-resort: query se kuch match nahi hua to 4 diverse popular products
  // return karo — different categories se, na ki saari sarees.
  try {
    const Product = require('../models/Product');
    const popular = await Product.aggregate([
      { $match: { isActive: true } },
      { $sort: { rating: -1, salesCount: -1, createdAt: -1 } },
      { $group: { _id: '$category', doc: { $first: '$$ROOT' } } },
      { $replaceRoot: { newRoot: '$doc' } },
      { $limit: 4 },
    ]);
    if (popular.length === 0) return [];
    await Product.populate(popular, { path: 'seller', select: 'shopName isVerifiedSeller' });
    return popular.map((p) => shapeFromDB({ match_score: 0 }, p));
  } catch (err) {
    logger.warn('Nearest-product fallback failed:', err.message);
    return [];
  }
}

/**
 * POST /api/recommendations/search
 * Fallback chain: HF model → title lookup → local regex search → nearest product.
 * Guarantee: agar DB mein ek bhi active product hai, response kabhi empty nahi.
 */
router.post('/search', async (req, res) => {
  try {
    const { query, city } = req.body;
    if (!query || typeof query !== 'string' || query.trim() === '') {
      return res.status(400).json({ success: false, message: 'Query is required', results: [] });
    }
    const q = query.trim();

    let hfData = null;
    try {
      hfData = await callHF('/recommend', { query: q, city: city || null });
    } catch (e) {
      logger.warn('HF /recommend unavailable, will use local fallback:', e.message);
    }

    let results = await enrichWithImages(normalize(hfData));
    let source = 'hf';

    // HF ke results kam aaye toh local DB se augment karo (HF service mostly
    // demo data return karta hai — local DB mein zyada variety hai).
    if (results.length < 6) {
      const localExtras = await localFallbackSearch(q, { limit: 12 });
      const seen = new Set(results.map((r) => String(r._id)));
      const merged = [...results];
      for (const ex of localExtras) {
        if (!seen.has(String(ex._id))) {
          merged.push(ex);
          seen.add(String(ex._id));
        }
      }
      if (merged.length > results.length) {
        results = merged;
        source = results.length > 0 && hfData ? 'hf+local' : 'local';
      }
    }

    if (results.length === 0) {
      results = await nearestProduct(q);
      source = 'nearest';
    }

    return res.json({
      success: true,
      results,
      source,
      searched_product: hfData?.searched_product || null,
      product_found: !!hfData?.product_found,
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
