/**
 * queryEnricher.js — Gemini-powered query understanding.
 *
 * Takes a freeform user search ("haldi 1kg", "kuch achha gift for mom",
 * "wedding ke liye necklace"), returns clean English keywords to feed
 * into the local product search.
 *
 * Disabled gracefully if GEMINI_API_KEY is not set — caller code should
 * fall back to the basic synonym map in that case.
 *
 * Free tier (gemini-2.5-flash, no card): 60 req/min — plenty for a
 * search endpoint. Each call is ~200-500ms.
 *
 * Get a key: https://aistudio.google.com/apikey  → .env GEMINI_API_KEY=...
 */

const logger = require('../utils/logger');

const GEMINI_KEY = process.env.GEMINI_API_KEY;
let client = null;
let clientFailed = false;

// In-memory LRU cache so identical queries don't burn quota.
const CACHE_MAX = 500;
const cache = new Map();
function cacheGet(k) {
  if (!cache.has(k)) return null;
  const v = cache.get(k);
  cache.delete(k);
  cache.set(k, v);
  return v;
}
function cacheSet(k, v) {
  cache.set(k, v);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

function getClient() {
  if (clientFailed || !GEMINI_KEY) return null;
  if (client) return client;
  try {
    const { GoogleGenAI } = require('@google/genai');
    client = new GoogleGenAI({ apiKey: GEMINI_KEY });
    return client;
  } catch (err) {
    logger.warn('Gemini SDK init failed (non-fatal):', err.message);
    clientFailed = true;
    return null;
  }
}

const SYSTEM_PROMPT = `You are a product-search query analyzer for an Indian local commerce app called Lokaly.
The user types a search in English, Hindi, or Hinglish. Your job:
1. Translate Hindi/Hinglish product names to common English equivalents (haldi→turmeric, jhumka→earrings, kapde→clothes, etc.).
2. Extract 3-8 short search keywords useful for matching product titles/categories/tags.
3. Detect category hint if obvious.

Respond with COMPACT JSON only, no markdown, no explanation. Schema:
{"keywords": ["string", ...], "category": "string or null", "intent": "buy|gift|browse"}

Examples:
"haldi 1kg" → {"keywords":["turmeric","haldi","spice","powder"],"category":"food","intent":"buy"}
"wedding ke liye necklace" → {"keywords":["necklace","wedding","bridal","jewelry","kundan"],"category":"jewelry","intent":"buy"}
"gift for mom diwali" → {"keywords":["diya","pooja","diwali","decor","saree"],"category":null,"intent":"gift"}
"blue saree under 1500" → {"keywords":["saree","blue","cotton","handloom"],"category":"handloom","intent":"buy"}`;

async function enrichQuery(rawQuery) {
  const q = String(rawQuery || '').trim().toLowerCase();
  if (!q) return null;
  const cached = cacheGet(q);
  if (cached) return cached;

  const c = getClient();
  if (!c) return null;

  try {
    const res = await c.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: `${SYSTEM_PROMPT}\n\nUser query: "${q}"\n\nJSON:` }] }],
      config: {
        temperature: 0.2,
        maxOutputTokens: 200,
        responseMimeType: 'application/json',
      },
    });
    const text = res?.text || res?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text) return null;
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Sometimes the model wraps in ```json fence — strip and retry.
      const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
      parsed = JSON.parse(stripped);
    }
    const out = {
      keywords: Array.isArray(parsed?.keywords) ? parsed.keywords.map(String).slice(0, 12) : [],
      category: parsed?.category || null,
      intent: parsed?.intent || 'buy',
    };
    if (out.keywords.length === 0) return null;
    cacheSet(q, out);
    return out;
  } catch (err) {
    logger.warn('Gemini enrichQuery failed (non-fatal):', err.message);
    return null;
  }
}

function isEnabled() {
  return !!GEMINI_KEY && !clientFailed;
}

module.exports = { enrichQuery, isEnabled };
