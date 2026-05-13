/**
 * voiceIntent.js — Gemini-powered intent parser for voice shopping.
 *
 * Takes a raw freeform query (often Hinglish) like
 *   "Bhaiya 300 ke under shoes dikhao, Bhopal me, jaldi chahiye"
 * and returns a structured intent:
 *   {
 *     action: 'search' | 'add_to_cart' | 'buy_now' | 'remove_from_cart' | 'checkout' | 'help',
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

// Lazy-loaded Google Translate (free wrapper, no API key needed). If the
// install or call fails, we silently fall back to the Devanagari synonym map.
let translateFn = null;
let translateFailed = false;
async function loadTranslate() {
  if (translateFailed) return null;
  if (translateFn) return translateFn;
  try {
    const mod = await import('@vitalets/google-translate-api');
    translateFn = mod.translate || mod.default?.translate || mod.default;
    return translateFn;
  } catch (err) {
    logger.warn('Google Translate init failed (non-fatal):', err.message);
    translateFailed = true;
    return null;
  }
}

// Preserves intent action words even after translation. We extract them BEFORE
// sending the query to translate (which often mangles short phrases like
// "ऑर्डर करना" → "to order" but loses the actionable verb structure).
const TRANSLATE_CACHE = new Map();

/**
 * If the query has any non-Latin characters, run it through Google Translate
 * to English. We append the translation to the original so action regexes
 * (which understand both scripts) still fire, AND keyword tokens get the
 * English forms the DB stores.
 */
async function translateToEnglish(rawQuery) {
  const text = String(rawQuery || '').trim();
  if (!text) return text;
  // Quick check: is there any non-Latin char that's also not a digit/punct?
  // Devanagari, Bengali, Tamil, Telugu, Gujarati, Kannada, Malayalam, etc.
  const NON_LATIN = /[ऀ-෿]/;
  if (!NON_LATIN.test(text)) return text;

  const cacheKey = text.toLowerCase();
  if (TRANSLATE_CACHE.has(cacheKey)) return TRANSLATE_CACHE.get(cacheKey);

  const translate = await loadTranslate();
  if (!translate) return text;

  try {
    const result = await translate(text, { to: 'en' });
    const english = (result?.text || '').trim();
    if (!english) return text;
    // Concat — original first so action regexes that match Devanagari still
    // fire, then English so keyword tokens hit the DB. Lowercased.
    const merged = `${text} ${english}`;
    TRANSLATE_CACHE.set(cacheKey, merged);
    if (TRANSLATE_CACHE.size > 500) {
      TRANSLATE_CACHE.delete(TRANSLATE_CACHE.keys().next().value);
    }
    return merged;
  } catch (err) {
    logger.warn('Google Translate call failed (non-fatal):', err.message);
    return text;
  }
}

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
- "add_to_cart"     User said: "add to cart", "cart me dal do", "yeh le lo", "seller A wala add karo".
- "buy_now"         User said: "buy now", "abhi khareedo", "yeh khareed lo", "isko le lo", "buy this".
- "remove_from_cart" "cart se hata do", "remove", "cancel this".
- "checkout"        "order place karo", "confirm karo", "yes confirm", "checkout", "checkout karo".
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
  // Roman-script Hinglish
  haldi: 'turmeric', kapda: 'clothes', kapde: 'clothes',
  jhumka: 'earrings', jhumke: 'earrings',
  juti: 'footwear', jutti: 'footwear', mojari: 'footwear', chappal: 'footwear',
  zewar: 'jewelry', kangan: 'bangles', payal: 'anklet',
  saari: 'saree', sari: 'saree',
  chai: 'tea', mithai: 'sweets', achaar: 'pickle', masala: 'spice',
  chaval: 'rice', chawal: 'rice', dawai: 'medicine',
  dudh: 'milk', doodh: 'milk', cheeni: 'sugar', sugar: 'sugar',
  bartan: 'utensils', diya: 'diya', pooja: 'pooja',

  // Devanagari script — common shopping terms (most STT engines on Hindi
  // phones return Devanagari, not Roman). Map them straight to the English
  // term used in product titles so DB regex search hits.
  'साड़ी': 'saree', 'साडी': 'saree',
  'कुर्ता': 'kurta', 'कुर्ती': 'kurti',
  'लहंगा': 'lehenga',
  'दुपट्टा': 'dupatta',
  'शर्ट': 'shirt', 'टी-शर्ट': 't-shirt', 'टीशर्ट': 't-shirt',
  'जींस': 'jeans',
  'जूते': 'footwear', 'जुत्ती': 'footwear', 'जुटी': 'footwear', 'चप्पल': 'footwear', 'मोजड़ी': 'footwear',
  'झुमका': 'earrings', 'झुमके': 'earrings', 'कान-की-बाली': 'earrings',
  'गहना': 'jewelry', 'गहने': 'jewelry', 'जेवर': 'jewelry',
  'चूड़ी': 'bangles', 'कंगन': 'bangles',
  'पायल': 'anklet',
  'हार': 'necklace',
  'अंगूठी': 'ring',
  'घड़ी': 'watch',
  'चश्मा': 'glasses', 'चश्मे': 'glasses',
  'बैग': 'bag', 'पर्स': 'purse',
  'कपड़ा': 'cloth', 'कपड़े': 'clothes',
  'हल्दी': 'turmeric',
  'चाय': 'tea',
  'मिठाई': 'sweets',
  'अचार': 'pickle', 'आचार': 'pickle',
  'मसाला': 'spice', 'मसाले': 'spice',
  'चावल': 'rice',
  'दूध': 'milk',
  'चीनी': 'sugar',
  'दवा': 'medicine', 'दवाई': 'medicine',
  'बर्तन': 'utensils',
  'दीया': 'diya', 'दीये': 'diya',
  'पूजा': 'pooja',
  'फोन': 'phone', 'मोबाइल': 'mobile',
  'आईफोन': 'iphone', 'सैमसंग': 'samsung',
  'लैपटॉप': 'laptop', 'टैबलेट': 'tablet',
  'किताब': 'book', 'किताबें': 'books',
  'खाना': 'food',
  'पानी': 'water',
  // Colors
  'काला': 'black', 'सफ़ेद': 'white', 'सफेद': 'white',
  'लाल': 'red', 'नीला': 'blue', 'हरा': 'green',
  'पीला': 'yellow', 'गुलाबी': 'pink',
  'भूरा': 'brown', 'सुनहरा': 'gold', 'चांदी': 'silver',
};

// Hindi (Devanagari) stopwords + filler words. Same role as the Roman
// stopwords below — these never become search keywords.
const DEVA_STOPWORDS = [
  'मुझे', 'मुझको', 'मेरा', 'मेरी', 'मेरे',
  'आप', 'आपके', 'आपको', 'आपकी',
  'एक', 'दो', 'तीन', 'चार', 'पांच',
  'चाहिए', 'चाहिये', 'है', 'हैं', 'हो', 'हूं', 'हूँ',
  'का', 'के', 'की', 'को', 'से', 'में', 'पर', 'पे',
  'और', 'या', 'भी', 'तो', 'ही', 'हाँ', 'नहीं',
  'क्या', 'कौन', 'कब', 'कहाँ', 'क्यों', 'कैसे',
  'करना', 'करनी', 'करें', 'करो', 'करूँ', 'करूंगा',
  'दिखाओ', 'दिखाइए', 'बताओ', 'लाओ',
  'अच्छा', 'अच्छी', 'सस्ता', 'सस्ती', 'महंगा',
  'कुछ', 'कोई',
  'रुपये', 'रुपए', 'रूपये', 'रूपए',
  // Action-verb words: these are intent signals, not product names.
  'ऑर्डर', 'आर्डर', 'ओर्डर', 'खरीद', 'खरीदना', 'खरीदो',
  'कार्ट',
];

const URGENCY_HINTS = [
  [/(\bjaldi\b|\baaj\b|\babhi\b|\btoday\b|\bnow\b)/i, 'today'],
  [/(\bkal\b|\btomorrow\b)/i, 'tomorrow'],
  [/(\bthis week\b|\bis hafte\b)/i, 'this_week'],
];

const ACTION_HINTS = [
  // Order matters — buy_now / add_to_cart / checkout / remove_from_cart.
  // Both ऑर्डर (U+0911) and आर्डर (U+0906) spellings appear from Hindi STT.
  // We also recognize the standalone English verbs "order" / "buy" with
  // intent particles ("want to order", "let me buy"), since translation often
  // produces them without the Hinglish "kar" auxiliary.
  [
    /(\bbuy now\b|\babhi khareed\b|\bisko le lo\b|\byeh khareed\b|\bkharid lo\b|\bkhareed lo\b|खरीद ?लो|खरीदना है|अभी खरीद|ऑर्डर कर|आर्डर कर|order kar(?:o|na|ni|ein)?|ऑर्डर करना|आर्डर करना|\b(?:want to|wanna|let me|need to|please|gonna|going to|i'?ll)\s+(?:order|buy|purchase)\b|\bplace (?:an )?order\b|\b(?:order|buy|purchase) (?:a|an|one|this|the)\b)/i,
    'buy_now',
  ],
  [
    /(\badd to cart\b|\bcart me\b|\bcart mein\b|\byeh le lo\b|\badd karo\b|\bcart me dal\b|\bcart mein dal\b|कार्ट में|कार्ट मे|कार्ट डालो|यह ले लो|\bput (?:it|this) in (?:my )?cart\b)/i,
    'add_to_cart',
  ],
  [
    /(\bremove\b|\bcart se hata\b|\bcancel\b|\bnikalo\b|हटाओ|निकालो|कैंसल|रद्द)/i,
    'remove_from_cart',
  ],
  [
    /(\border place\b|\bconfirm\b|\byes confirm\b|\bcheckout\b|\bplace order\b|\bhaan confirm\b|\bcheckout karo\b|चेकआउट|कन्फर्म|पुष्टि|\bpay now\b|\bproceed to (?:checkout|payment)\b)/i,
    'checkout',
  ],
];

const COLORS = ['black','white','red','blue','green','yellow','orange','pink','purple','brown','grey','gray','beige','maroon','navy','cream','gold','silver','peach','olive'];

function fallbackParse(rawQuery) {
  const original = String(rawQuery);
  const q = original.toLowerCase();
  // Tokenize on whitespace/punctuation, but PRESERVE non-ASCII (Devanagari).
  // The previous regex only stripped a tiny set of punctuation — that's fine,
  // but we case-fold ASCII only. Devanagari has no concept of case.
  const tokens = q.split(/[\s,.;:!?।॥]+/).filter(Boolean);

  let action = 'search';
  for (const [re, a] of ACTION_HINTS) if (re.test(original)) { action = a; break; }

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

  // Keywords: translate Hindi (Roman + Devanagari) → English, drop fillers.
  const stop = new Set([
    // English/Hinglish stopwords + grammatical particles introduced by
    // Google Translate ("I want to order a saree" → ["i","want","to","order","a","saree"])
    'the','and','for','under','with','from','into','over','best','cheap',
    'bhaiya','didi','sir','madam','please','de','do','ka','ke','ki','me','mein',
    'par','pe','ko','se','jo','ye','yeh','wo','woh','chahiye','dikhao','batao',
    'lao','mujhe','aapke','aapko','le','lo','mere','meri','mera','main','hai',
    'hain','hu','hun','ho','rupees','rs','tak','rupaye','rupay','rupee',
    // English filler/intent verbs — they steer the action, not the search
    'i','you','we','they','my','your','want','wants','wanna','need','needs',
    'order','orders','ordering','buy','buying','purchase','purchasing',
    'place','add','remove','show','find','get','gimme','give','please',
    'a','an','one','this','that','to','of','in','on','at','is','are','am',
    'will','would','let','me','us','some','any','what','can','could','should',
    'cart','checkout','help',
    // Devanagari stopwords (loaded from DEVA_STOPWORDS)
    ...DEVA_STOPWORDS,
  ]);

  const keywords = Array.from(new Set(
    tokens
      // Translate via the synonym map. The map covers both Roman and
      // Devanagari forms, so a Hindi STT result like "साड़ी" becomes "saree"
      // before any further filtering — making it match products in the DB.
      .map((t) => HINDI_SYN[t] || t)
      .filter((t) => {
        if (t.length < 2) return false;
        if (stop.has(t)) return false;
        if (/^\d+$/.test(t)) return false;
        return true;
      }),
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
    const what = keywords[0] || 'item';
    spoken_response = `${what} cart me daal diya. Confirm karne ke liye 'checkout karo' boliye.`;
  } else if (action === 'buy_now') {
    const what = keywords[0] || 'product';
    // If keywords are present we'll be returning candidate products; prompt
    // the user to confirm one. Without keywords, we'll act on the anchor.
    if (keywords.length > 0) {
      spoken_response = `${what} ke options dikha rahi hu. Jo chahiye uspe 'Buy now' tap karein, ya 'pehla wala buy now' boliye.`;
    } else {
      spoken_response = 'Theek hai, abhi khareed rahi hu. Checkout par le ja rahi hu.';
    }
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
  const original = String(rawQuery || '').trim();
  if (!original) return null;
  const cached = cacheGet(original.toLowerCase());
  if (cached) return cached;

  // Pre-process: if the query contains Devanagari/Bengali/Tamil/etc, run it
  // through Google Translate so we always have an English form to parse.
  // The original is preserved (Hindi action regexes still fire on it) and
  // the English form is appended for keyword extraction.
  const q = await translateToEnglish(original);

  const c = getClient();
  if (!c) {
    const fb = fallbackParse(q);
    cacheSet(original.toLowerCase(), fb);
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
      cacheSet(original.toLowerCase(), out);
      return out;
    }
    // Gemini returned junk — fall back
    const fb = fallbackParse(q);
    cacheSet(original.toLowerCase(), fb);
    return fb;
  } catch (err) {
    logger.warn('Gemini intent parse failed (non-fatal):', err.message);
    const fb = fallbackParse(q);
    cacheSet(original.toLowerCase(), fb);
    return fb;
  }
}

module.exports = { parseIntent, fallbackParse };
