/**
 * POST /api/chat
 * Conversational shopping assistant. Calls HF Llama 3.3 70B via chatService,
 * augments reply with product suggestions from local Mongo.
 *
 * Body: { query: string, history?: [{role, content}] }
 * Returns: { answer, products }
 *
 * Backwards-compat: also accepts { message } as an alias for query so the
 * frontend ChatbotWidget can keep its existing payload shape.
 */

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { chatComplete, suggestProducts } = require('../services/chatService');

router.post('/', async (req, res) => {
  const query = String(req.body?.query || req.body?.message || '').trim();
  if (!query) {
    return res.status(400).json({ error: 'query required', answer: '', products: [] });
  }
  const history = Array.isArray(req.body?.history) ? req.body.history.slice(-8) : [];

  try {
    const messages = [...history, { role: 'user', content: query }];
    // Pull products first (so the LLM can reason about why they fit).
    const products = await suggestProducts(query);
    const reply = await chatComplete(messages, products);
    return res.json({
      answer: reply.answer,
      why: reply.why,
      followups: reply.followups,
      products,
    });
  } catch (err) {
    logger.warn('chat endpoint failed:', err.response?.data || err.message);
    return res.status(502).json({
      error: 'chat service unavailable',
      answer: 'Sorry, abhi thoda issue aa raha hai. Ek minute mein dobara try karein.',
      followups: [],
      products: [],
    });
  }
});

module.exports = router;
