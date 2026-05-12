const LiveSession = require('../models/LiveSession');
const { award } = require('./coinsService');

const COINS_PER_BUYER = 2;

/**
 * Called from paymentController.verify once an order is paid.
 * If the order is tied to a live session that has a group-buy goal,
 * register this buyer and (if threshold is hit) award every buyer
 * COINS_PER_BUYER community coins. Idempotent — coins are awarded
 * at most once per session, guarded by `groupBuy.coinsAwarded`.
 */
async function recordGroupBuyPurchase({ liveSessionId, buyerId, orderId }) {
  if (!liveSessionId || !buyerId) return { skipped: true };

  const s = await LiveSession.findById(liveSessionId);
  if (!s || !s.groupBuy || !s.groupBuy.threshold) return { skipped: true };

  // Dedupe — same buyer paying twice in the same session counts once.
  const already = (s.groupBuy.buyers || []).some(
    (u) => String(u) === String(buyerId),
  );
  if (!already) s.groupBuy.buyers.push(buyerId);

  const buyerCount = s.groupBuy.buyers.length;
  const reached = buyerCount >= s.groupBuy.threshold;

  let coinsAwarded = false;
  if (reached && !s.groupBuy.coinsAwarded) {
    s.groupBuy.coinsAwarded = true;
    // Award every confirmed buyer COINS_PER_BUYER coins.
    await Promise.all(
      s.groupBuy.buyers.map((uid) =>
        award(uid, COINS_PER_BUYER, 'group_buy_purchase', {
          sessionId: s._id,
          orderId,
          discountPct: s.groupBuy.discountPct,
        }).catch((err) => {
          // eslint-disable-next-line no-console
          console.error(
            `[groupBuyService] coin award failed for user ${uid}:`,
            err.message,
          );
          return null;
        }),
      ),
    );
    coinsAwarded = true;
  }

  await s.save();
  return {
    buyerCount,
    threshold: s.groupBuy.threshold,
    reached,
    coinsAwarded,
    coinsPerBuyer: coinsAwarded ? COINS_PER_BUYER : 0,
  };
}

module.exports = { recordGroupBuyPurchase, COINS_PER_BUYER };
