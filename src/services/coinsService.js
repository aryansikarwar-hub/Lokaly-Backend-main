const User = require('../models/User');
const CoinLedger = require('../models/CoinLedger');

async function award(userId, delta, reason, meta = {}) {
  const user = await User.findById(userId);
  if (!user) throw new Error('user not found');
  user.coins = Math.max(0, (user.coins || 0) + delta);
  await user.save();
  await CoinLedger.create({ user: userId, delta, reason, meta, balanceAfter: user.coins });
  return user.coins;
}

async function ledger(userId, { limit = 50 } = {}) {
  return CoinLedger.find({ user: userId }).sort({ createdAt: -1 }).limit(limit);
}

// Sweeps any positive-delta ledger rows whose expiresAt has passed, groups by user,
// sums the expired amount, inserts one negative "coin_expiry" row per user, and
// decrements User.coins. Marks expired rows so we never double-count them.
async function expireCoins({ now = new Date() } = {}) {
  const expiredRows = await CoinLedger.aggregate([
    {
      $match: {
        delta: { $gt: 0 },
        expiresAt: { $ne: null, $lte: now },
        expiredAt: null,
      },
    },
    { $group: { _id: '$user', total: { $sum: '$delta' }, ids: { $push: '$_id' } } },
  ]);

  const results = [];
  for (const row of expiredRows) {
    const amount = row.total;
    if (!amount || amount <= 0) continue;
    try {
      const user = await User.findById(row._id);
      if (!user) continue;
      const newBalance = Math.max(0, (user.coins || 0) - amount);
      user.coins = newBalance;
      await user.save();
      await CoinLedger.create({
        user: row._id,
        delta: -amount,
        reason: 'coin_expiry',
        meta: { expiredRowCount: row.ids.length },
        balanceAfter: newBalance,
      });
      await CoinLedger.updateMany(
        { _id: { $in: row.ids } },
        { $set: { expiredAt: now } }
      );
      results.push({ user: String(row._id), expired: amount });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[coinsService.expireCoins] failed for user', String(row._id), err.message);
    }
  }
  return { processed: results.length, details: results };
}

// Spec-named alias (task 7 asked for `expireStaleCoins`).
const expireStaleCoins = expireCoins;

/**
 * Wire a periodic coin-expiry sweep — once on start, then every `intervalMs`.
 * Safe to call multiple times; callers store the returned handle if they want
 * to stop it. setTimeout/setInterval are unref'd so they don't block process exit.
 */
function startCoinExpiryJob(intervalMs = 24 * 60 * 60 * 1000) {
  const first = setTimeout(() => {
    expireStaleCoins().catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('[coinsService] first expiry sweep failed:', err.message);
    });
  }, 15000);
  first.unref?.();
  const handle = setInterval(() => {
    expireStaleCoins().catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('[coinsService] expiry sweep failed:', err.message);
    });
  }, intervalMs);
  handle.unref?.();
  return handle;
}

/**
 * Task 8 sweep — expires rewards older than 365 days with reasons
 * ['order_reward','live_spin','review','referral_bonus']. Inserts one
 * negative ledger entry per user with reason='expiry', decrements User.coins,
 * and marks the expired source rows so they are never swept again.
 */
async function runCoinExpiry({ now = new Date(), ageDays = 365 } = {}) {
  const REWARD_REASONS = ['order_reward', 'live_spin', 'review', 'referral_bonus'];
  const cutoff = new Date(now.getTime() - ageDays * 24 * 60 * 60 * 1000);

  const rows = await CoinLedger.aggregate([
    {
      $match: {
        delta: { $gt: 0 },
        reason: { $in: REWARD_REASONS },
        createdAt: { $lte: cutoff },
        expiredAt: null,
      },
    },
    { $group: { _id: '$user', total: { $sum: '$delta' }, ids: { $push: '$_id' } } },
  ]);

  const results = [];
  for (const row of rows) {
    const amount = row.total;
    if (!amount || amount <= 0) continue;
    try {
      const user = await User.findById(row._id);
      if (!user) continue;
      const newBalance = Math.max(0, (user.coins || 0) - amount);
      user.coins = newBalance;
      await user.save();
      await CoinLedger.create({
        user: row._id,
        delta: -amount,
        reason: 'expiry',
        meta: { expiredRowCount: row.ids.length, ageDays },
        balanceAfter: newBalance,
      });
      await CoinLedger.updateMany(
        { _id: { $in: row.ids } },
        { $set: { expiredAt: now, expired: true } }
      );
      results.push({ user: String(row._id), expired: amount });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[coinsService.runCoinExpiry] failed for user', String(row._id), err.message);
    }
  }
  return { processed: results.length, details: results };
}

module.exports = { award, ledger, expireCoins, expireStaleCoins, startCoinExpiryJob, runCoinExpiry };
