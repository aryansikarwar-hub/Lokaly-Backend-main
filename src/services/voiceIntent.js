/**
 * voiceIntent.js — Gemini-powered intent parser for voice shopping.
 *
 * Takes a raw freeform query (often Hinglish) like
 *   "Bhaiya 300 ke under shoes dikhao, Bhopal me, jaldi chahiye"
 * and returns a structured intent:
 *   {
 *     action: 'search' | 'add_to_cart' | 'remove_from_cart' | 'checkout' | 'help',
 *     keywords: string[],           // English search terms
 *     category: string | null,
 *     color: string | null,
 *     size: string | null,
 *     budget_max: number | null,
 *     location: string | null,      // city / area
 *     urgency: 'today' | 'tomorrow' | 'this_week' | null,
 *     quantity: number | null,
 *     spoken_response: string,      // Hinglish TTS line to speak back
 *   }
 *
 * If GEMINI_API_KEY isn't set, falls back to a regex+synonym parser that
 * covers common cases (budget, color, urgency keywords).
 *
 * Gemini cache: same query → same parse (saves quota).
 */

const logger = require('../utils/logger');

const GEMINI_KEY = process.env.GEMINI_API_KEY;
let client = null;
let clientFailed = false;

// LRU cache for parsed intents — same voice query → same structured output.
const CACHE_MAX = 300;
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
    logger.warn('Gemini init failed:', err.message);
    clientFailed = true;
    return null;
  }
}

const SYSTEM_PROMPT = `You are the intent parser for Lokaly, an Indian hyperlocal voice-shopping app.
Users speak Hinglish (mix of Hindi + English). Parse each spoken query into a
JSON object that the order pipeline can act on.

ACTIONS — pick exactly one:
- "search"          User wants to find products. Default for descriptive queries.
- "add_to_cart"     User said: "add to cart", "buy this", "cart me dal do", "yeh le lo", "seller A wala add karo".
- "remove_from_cart" "cart se hata do", "remove", "cancel this".
- "checkout"        "order place karo", "confirm karo", "yes confirm", "checkout".
- "help"            Generic question, can't parse.

KEYWORDS — English search terms (lowercase). Translate Hinglish:
- "saree" stays "saree"; "kapde" → "clothes"; "haldi" → "turmeric";
- "jhumke" → "earrings"; "juti/mojari" → "footwear";
- Brand/material names stay (e.g. "banarasi", "cotton")

BUDGET — extract max price as a number. Convert "₹500", "500 rupees",
"500 ke under", "300 tak", "thousand", "do hazaar" → integer. null if absent.

COLOR — single English color word if mentioned ("black", "red", "blue"), else null.

SIZE — clothing/shoe size if mentioned ("XL", "42", "small"), else null.

LOCATION — Indian city or area name if mentioned ("Bhopal", "Jaipur", "Arera Colony"). null otherwise.

URGENCY:
- "today", "abhi", "jaldi", "aaj"           → "today"
- "tomorrow", "kal"                          → "tomorrow"
- "this week", "is hafte"                    → "this_week"
- silent → null

QUANTITY — integer if multiple items requested ("2 packet maggi", "do kilo aata"), else null.

SPOKEN_RESPONSE — a short Hinglish reply for TTS. Confirm what you understood
and ask the next question if needed. Max 18 words. Examples:
- "Theek hai, 300 ke under shoes dhundh rahi hu Bhopal mein."
- "Cart me daal diya. Confirm karna ho to 'order place karo' boliye."
- "Black t-shirt XL size, kitne tak budget?"

OUTPUT — STRICT JSON only, no markdown:
{
  "action": "search",
  "keywords": ["..."],
  "category": "..." | null,
  "color": "..." | null,
  "size": "..." | null,
  "budget_max": 500 | null,
  "location": "..." | null,
  "urgency": "today" | "tomorrow" | "this_week" | null,
  "quantity": 1 | null,
  "spoken_response": "..."
}`;

const HINDI_SYN = {
  haldi: 'turmeric', kapda: 'clothes', kapde: 'clothes',
  jhumka: 'earrings', jhumke: 'earrings',
  juti: 'footwear', jutti: 'footwear', mojari: 'footwear', chappal: 'footwear',
  zewar: 'jewelry', kangan: 'bangles', payal: 'anklet',
  saari: 'saree', sari: 'saree',
  chai: 'tea', mithai: 'sweets', achaar: 'pickle', masala: 'spice',
  chaval: 'rice', chawal: 'rice', dawai: 'medicine',
  dudh: 'milk', doodh: 'milk', cheeni: 'sugar', sugar: 'sugar',
  bartan: 'utensils', diya: 'diya', pooja: 'pooja',
};

const URGENCY_HINTS = [
  [/(\bjaldi\b|\baaj\b|\babhi\b|\btoday\b|\bnow\b)/i, 'today'],
  [/(\bkal\b|\btomorrow\b)/i, 'tomorrow'],
  [/(\bthis week\b|\bis hafte\b)/i, 'this_week'],
];

const ACTION_HINTS = [
  [/(\badd to cart\b|\bcart me\b|\bcart mein\b|\bbuy this\b|\byeh le lo\b|\bkharidlo\b|\badd karo\b)/i, 'add_to_cart'],
  [/(\bremove\b|\bcart se hata\b|\bcancel\b|\bnikalo\b)/i, 'remove_from_cart'],
  [/(\border place\b|\bconfirm\b|\byes confirm\b|\bcheckout\b|\bplace order\b|\bhaan confirm\b)/i, 'checkout'],
];

const COLORS = ['black','white','red','blue','green','yellow','orange','pink','purple','brown','grey','gray','beige','maroon','navy','cream','gold','silver','peach','olive'];

function fallbackParse(rawQuery) {
  const q = String(rawQuery).toLowerCase();
  const tokens = q.split(/[\s,.;:!?]+/).filter(Boolean);

  let action = 'search';
  for (const [re, a] of ACTION_HINTS) if (re.test(q)) { action = a; break; }

  let urgency = null;
  for (const [re, u] of URGENCY_HINTS) if (re.test(q)) { urgency = u; break; }

  // Budget: e.g. "300 ke under", "under 500", "500 tak"
  let budget_max = null;
  const bmA = q.match(/(\d{2,6})\s*(ke under|tak|under|ke andar|rs|₹)/);
  const bmB = q.match(/(under|less than)\s*(\d{2,6})/);
  if (bmA) budget_max = Number(bmA[1]);
  else if (bmB) budget_max = Number(bmB[2]);

  const color = COLORS.find((c) => tokens.includes(c)) || null;

  const sizeM = q.match(/\b(xs|s|m|l|xl|xxl|3xl|small|medium|large)\b/i);
  const size = sizeM ? sizeM[1].toUpperCase() : null;

  // Indian city detect — small list, expand if needed
  const CITIES = ['mumbai','delhi','bengaluru','bangalore','hyderabad','chennai','kolkata','pune','jaipur','lucknow','kochi','surat','ahmedabad','bhopal','indore','nagpur'];
  const location = CITIES.find((c) => q.includes(c)) || null;

  const qtyM = q.match(/(\d+)\s*(packet|kilo|kg|piece|number|nos|bottle|litre)/);
  const quantity = qtyM ? Number(qtyM[1]) : null;

  // Keywords: translate Hindi → English where possible, drop fillers
  const stop = new Set(['the','and','for','under','with','from','into','over','best','cheap','bhaiya','didi','sir','madam','please','de','do','ka','ke','ki','me','mein','par','pe','ko','se','jo','ye','yeh','wo','woh','chahiye','dikhao','batao','lao','mujhe','aapke','aapko','le','lo','mere','meri','mera','mein','main','hai','hain','hu','hun','ho','ka','hai','rupees','rs','tak','under','rupaye','rupay','rupee']);
  const keywords = Array.from(new Set(
    tokens
      .map((t) => HINDI_SYN[t] || t)
      .filter((t) => t.length >= 2 && !stop.has(t) && !/^\d+$/.test(t)),
  )).slice(0, 10);

  // Spoken_response: simple template
  let spoken_response = '';
  if (action === 'search') {
    const partsArr = [];
    if (color) partsArr.push(color);
    if (size) partsArr.push(size);
    const what = keywords[0] || 'products';
    spoken_response = `${partsArr.length ? partsArr.join(' ') + ' ' : ''}${what} dhundh rahi hu`;
    if (budget_max) spoken_response += ` ₹${budget_max} ke under`;
    if (location) spoken_response += ` ${location} mein`;
    spoken_response += '.';
  } else if (action === 'add_to_cart') {
    spoken_response = 'Cart me daal diya. Confirm karne ke liye order place karo boliye.';
  } else if (action === 'checkout') {
    spoken_response = 'Order confirm kar rahe hain.';
  } else if (action === 'remove_from_cart') {
    spoken_response = 'Cart se hata diya.';
  } else {
    spoken_response = 'Samajh nahi aaya. Phir se boliye.';
  }

  return {
    action, keywords, category: null, color, size,
    budget_max, location, urgency, quantity, spoken_response,
  };
}

function safeJsonParse(text) {
  if (!text) return null;
  let cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(cleaned); } catch {}
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(cleaned.slice(first, last + 1)); } catch {}
  }
  return null;
}

async function parseIntent(rawQuery) {
  const q = String(rawQuery || '').trim();
  if (!q) return null;
  const cached = cacheGet(q.toLowerCase());
  if (cached) return cached;

  const c = getClient();
  if (!c) {
    const fb = fallbackParse(q);
    cacheSet(q.toLowerCase(), fb);
    return fb;
  }

  try {
    const res = await c.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: `${SYSTEM_PROMPT}\n\nUser said: "${q}"\n\nJSON:` }] }],
      config: { temperature: 0.2, maxOutputTokens: 280, responseMimeType: 'application/json' },
    });
    const text = res?.text || res?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = safeJsonParse(text);
    if (parsed && parsed.action && Array.isArray(parsed.keywords)) {
      const out = {
        action: parsed.action,
        keywords: parsed.keywords.map(String).slice(0, 12),
        category: parsed.category || null,
        color: parsed.color || null,
        size: parsed.size || null,
        budget_max: typeof parsed.budget_max === 'number' ? parsed.budget_max : null,
        location: parsed.location || null,
        urgency: parsed.urgency || null,
        quantity: typeof parsed.quantity === 'number' ? parsed.quantity : null,
        spoken_response: parsed.spoken_response || '',
      };
      cacheSet(q.toLowerCase(), out);
      return out;
    }
    // Gemini returned junk — fall back
    const fb = fallbackParse(q);
    cacheSet(q.toLowerCase(), fb);
    return fb;
  } catch (err) {
    logger.warn('Gemini intent parse failed (non-fatal):', err.message);
    const fb = fallbackParse(q);
    cacheSet(q.toLowerCase(), fb);
    return fb;
  }
}

module.exports = { parseIntent, fallbackParse };
