const Message = require('../models/Message');
const { sentimentOf, ABUSIVE_KEYWORDS } = require('../controllers/mlController');
const { embed, cosine } = require('../ml/pipelines');

/**
 * Controlled Chats — classify an inbound message as safe / flagged.
 * Hybrid: keyword denylist (instant, language-agnostic) OR strong negative sentiment.
 */
async function moderateText(text) {
  if (!text) return { flagged: false, label: 'NEUTRAL', score: 0 };
  const lower = String(text).toLowerCase();
  const keywordHit = ABUSIVE_KEYWORDS.some((w) => lower.includes(w));

  let label = 'NEUTRAL';
  let score = 0;
  try {
    const s = await sentimentOf(text);
    label = s.label;
    score = s.score;
  } catch (_) { /* fall through to keyword only */ }

  const flagged = keywordHit || (label === 'NEGATIVE' && score > 0.95);
  return { flagged, label, score, keywordHit };
}

/**
 * Smart FAQ Auto-Responder.
 * Given a buyer message to a seller, find the most semantically similar past answer
 * the same seller gave. If cosine > 0.75, surface it as a suggested canned reply.
 */
const FAQ_SEED_ANSWERS = [
  'We usually ship within 24 hours. You\'ll get a tracking link via SMS once dispatched.',
  'Yes this fits most Indian body types, the size chart is on the product page. Please check measurements.',
  'Cash on delivery is available for orders above ₹299. UPI, cards and netbanking also supported.',
  'Return window is 7 days from delivery. Item must be unused with original tags.',
  'We deliver pan-India within 3-5 business days. Metro cities usually 2-3 days.',
];

async function suggestFaqReply({ fromUser, toUser, text }) {
  if (!text || !toUser) return null;

  // Load seller's past sent messages (answers to other buyers) in the last 90 days.
  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000);
  const pastAnswers = await Message.find({
    from: toUser,
    createdAt: { $gte: since },
    text: { $ne: '' },
  }).select('text').limit(200).sort({ createdAt: -1 });

  const corpus = pastAnswers.map((m) => m.text).filter((t) => t && t.length > 20);
  if (corpus.length < 3) corpus.push(...FAQ_SEED_ANSWERS);

  try {
    const qVec = await embed(text);
    let best = { text: null, score: 0 };
    for (const candidate of corpus) {
      const cVec = await embed(candidate.slice(0, 400));
      const sim = cosine(qVec, cVec);
      if (sim > best.score) best = { text: candidate, score: sim };
    }
    if (best.score >= 0.65) return best.text;
    return null;
  } catch (_) {
    return null;
  }
}

module.exports = { moderateText, suggestFaqReply };
