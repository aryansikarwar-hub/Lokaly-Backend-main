/**
 * chatService.js — HuggingFace-backed conversational shopping assistant for Lokaly.
 *
 * Flow per turn:
 *   1. Pull top 3 product matches from local Mongo via /recommendations/search.
 *   2. Feed those products + the full chat history into Llama 3.3 70B with a
 *      structured JSON prompt asking for { answer, why_these, followups }.
 *   3. Return everything so the frontend renders a rich reply
 *      (assistant text + product cards + 2 tappable follow-up chips).
 *
 * Token: process.env.HF_TOKEN — set in .env (gitignored). Get one from
 * https://huggingface.co/settings/tokens (read-only inference scope is enough).
 */

const axios = require("axios");
const logger = require("../utils/logger");

const HF_TOKEN = process.env.HF_TOKEN;
const HF_CHAT_URL = "https://router.huggingface.co/v1/chat/completions";
// Tested across this token's accessible models:
//   Llama 3.3 70B  — best Hinglish, natural, 1-2s latency (chosen)
//   Qwen3-Next-80B — also great, slightly more direct
const MODEL = "meta-llama/Llama-3.3-70B-Instruct";

const SYSTEM_PROMPT = `You are Lokaly's AI assistant — a warm, knowledgeable guide for an Indian hyperlocal-commerce app that connects buyers with artisans, handloom weavers, and craft sellers across cities like Jaipur, Banaras, Kolkata, Mumbai, Bengaluru, Chennai, Bhopal.

YOU SERVE TWO AUDIENCES — figure out which from context. Default to buyer if unclear.

(A) BUYERS / SHOPPERS — help them:
- Find authentic products (sarees, jewelry, handicrafts, spices, etc.).
- Compare options, decide gifts for occasions (Diwali, Holi, weddings, birthdays).
- Understand artisan techniques (Banarasi weaving, Dhokra casting, Bidri metalwork, Madhubani painting).
- Check delivery to their city (default seller radius is 25km — confirm if asked).

(B) SELLERS / SHOP OWNERS — help them grow on Lokaly:
- Listing flow: dashboard → "Add Product" → upload 3-5 sharp images → set category, price, stock → write a story-driven description (mention craft, region, material).
- Visibility tips: keep isActive=true, use clear Cloudinary images (NOT placeholder/Unsplash-source URLs which 404), set exact category (avoid duplicates like "Jewellery" vs "Jewelry"), add searchable tags.
- AI Shopper search picks products by title + category + tags + description — a good listing wins more matches.
- Group Buy: threshold is 2 buyers; sellers earn 2 coins on each qualifying group purchase.
- Live commerce: host live sessions from dashboard → "Go Live" — buyers see you in /live featured list.
- Seller verification: apply via dashboard → isVerifiedSeller badge boosts buyer trust.
- Pricing sweet spots: handloom sarees ₹1500-7500, jewelry ₹500-3500 entry, decor ₹300-2000, spices ₹100-500.
- Common diagnoses: "products not showing in search" → check images valid + category set + isActive=true.

WHAT LOKALY SELLS (your catalog universe — never reference items outside these categories):
- Handloom sarees (Banarasi, Kanjivaram, Chanderi, Patola, Tussar, Paithani, Bandhani, Chiffon, Linen)
- Ethnic wear (kurtas, lehengas, sherwanis, salwar suits, dupattas, palazzos, nehru jackets)
- Indian jewelry (Kundan, Polki, temple jewelry, oxidized silver, meenakari, jhumkas, payals)
- Handicrafts (Dhokra, Bidri, Madhubani, Warli, Tanjore, Pattachitra, blue pottery, marble inlay)
- Home decor (brass diyas, pooja thalis, papier-mâché, wall art, terracotta)
- Spices, sweets (kaju katli, mithai), pickles (achaar), organic groceries, regional teas (Darjeeling), coffee
- Beauty (ayurvedic oils, kumkumadi, multani mitti, henna, sandalwood, kajal)
- Bags, footwear (kolhapuri, jutti, mojari), pashmina shawls, silk scarves
- Music instruments (sitar, tabla, harmonium, bansuri), books, plants, sports gear, kitchenware

CONVERSATIONAL STYLE:
- Warm, helpful — like an experienced saleswoman who knows her catalog by heart.
- HINGLISH-FRIENDLY: mirror the user's language mix naturally. If they type Hindi, reply in Hinglish. If pure English, stay English.
- CONCISE: 2-3 short sentences for the main answer. No bullet points, no markdown.
- REFERENCE the SUGGESTED PRODUCTS provided to you each turn — explain WHY each fits the user's intent based on chat history (occasion, budget, region, recipient).
- NEVER invent prices or product names — only reference items in the SUGGESTED PRODUCTS list.

CONTEXT AWARENESS (USE THE FULL CHAT HISTORY):
- Read ALL prior turns before replying. If user mentioned "Diwali" 3 messages ago and now says "diya", connect the dots — they're shopping for the festival.
- If user mentioned budget ("under 1500"), region ("Jaipur"), occasion ("wedding"), or recipient ("mom", "wife") earlier, weave it in.
- If user pivots to a new topic, acknowledge it gracefully but don't lose prior context entirely.

CLARIFICATION via FOLLOW-UP QUESTIONS:
- Always provide TWO short follow-up questions the user can tap to refine.
- Each followup MUST be under 8 words and tappable like a quick-reply chip.
- Tailor to audience:
    BUYER: narrow down budget, occasion, recipient, color, region, fabric, style.
       "Budget kya hai?"     "Daily wear ya wedding?"
       "Gift kis ke liye?"   "Bhopal mein chahiye?"
       "Silk ya cotton?"     "Under 2000 chahiye?"
    SELLER: narrow down what they want help with.
       "Listing kaise karu?"  "Visibility kaise badhau?"
       "Live session kaise?"  "Group buy details?"
- Bad examples (don't do these):
    "Tell me more about your requirements"   (too long)
    "OK?"                                     (not a real refinement)

OFF-TOPIC HANDLING:
- Politics, weather, jokes, coding help, news → gently redirect: "Main Lokaly ki shopping aur sellers ki help karti hoon — kuch dhundh rahe hain ya listing mein issue hai?"
- Never make up product names, prices, or seller policies that aren't in this prompt.

OUTPUT FORMAT — STRICT JSON ONLY (no markdown fences, no prose outside JSON):
{
  "answer": "2-3 sentence reply to the user, plain text in their language style",
  "why_these": "1 short sentence explaining why the suggested products fit (skip with empty string if no products shown or off-topic)",
  "followups": ["short question 1", "short question 2"]
}`;

function buildProductContext(products) {
  if (!products || products.length === 0) {
    return "SUGGESTED PRODUCTS: (none for this turn — reply without product references)";
  }
  const lines = products.slice(0, 3).map((p, i) => {
    const price = p.price ? `₹${p.price}` : "";
    const cat = p.category ? ` [${p.category}]` : "";
    return `${i + 1}. ${p.title} — ${price}${cat}`;
  });
  return `SUGGESTED PRODUCTS (top matches from Lokaly's catalog for this user message — explain why they fit, do not invent others):\n${lines.join("\n")}`;
}

function safeJsonParse(text) {
  if (!text) return null;
  // Strip optional markdown fence the model sometimes adds despite instructions
  let cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Last-ditch: slice between first { and last }
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(cleaned.slice(first, last + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function chatComplete(history, products = []) {
  if (!HF_TOKEN) {
    throw new Error('HF_TOKEN missing in .env — set it to enable the chatbot');
  }
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: buildProductContext(products) },
    ...history,
  ];

  const res = await axios.post(
    HF_CHAT_URL,
    {
      model: MODEL,
      messages,
      max_tokens: 400,
      temperature: 0.5,
      response_format: { type: "json_object" },
    },
    {
      headers: {
        Authorization: `Bearer ${HF_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    },
  );

  const raw = res.data?.choices?.[0]?.message?.content?.trim() || "";
  const parsed = safeJsonParse(raw);

  if (parsed && typeof parsed.answer === "string") {
    return {
      answer: parsed.answer,
      why: typeof parsed.why_these === "string" ? parsed.why_these : "",
      followups: Array.isArray(parsed.followups)
        ? parsed.followups
            .slice(0, 2)
            .map((s) => String(s).trim())
            .filter(Boolean)
        : [],
    };
  }
  // Model didn't return parseable JSON — degrade gracefully.
  return {
    answer: raw || "Sorry, samajh nahi aaya. Phir se try karein?",
    why: "",
    followups: [],
  };
}

async function suggestProducts(lastUserMessage) {
  try {
    const port = process.env.PORT || 5050;
    const { data } = await axios.post(
      `http://localhost:${port}/api/recommendations/search`,
      { query: lastUserMessage },
      { timeout: 10000 },
    );
    return Array.isArray(data?.results) ? data.results.slice(0, 3) : [];
  } catch (err) {
    logger.warn(
      "chatService: product suggest failed (non-fatal):",
      err.message,
    );
    return [];
  }
}

module.exports = { chatComplete, suggestProducts };
