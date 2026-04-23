const Referral = require('../models/Referral');
const User = require('../models/User');
const { award } = require('./coinsService');

const GMV_THRESHOLD = 10000; // ₹

/**
 * Credit referrer when a referred-seller's GMV crosses the threshold.
 * Also pay 2% equity cashback on every order for qualified referrals (in coins: 1 coin = ₹1).
 */
async function recordSellerSale(sellerId, amount) {
  const ref = await Referral.findOne({ referredSeller: sellerId });
  if (!ref) return null;

  ref.gmv += amount;

  // Qualification milestone (one-time): bonus 500 coins to referrer.
  if (ref.status === 'pending' && ref.gmv >= GMV_THRESHOLD) {
    ref.status = 'qualified';
    ref.qualifiedAt = new Date();
    await award(ref.referrer, 500, 'referral_bonus', { sellerId, milestone: 'gmv_10k' });
  }

  // Lifetime equity cashback on every sale once qualified.
  if (ref.status === 'qualified') {
    const cashback = Math.round(amount * ref.cashbackRate);
    if (cashback > 0) {
      await award(ref.referrer, cashback, 'equity_cashback', { sellerId, amount });
      ref.cashbackPaidTotal += cashback;
    }
  }

  await ref.save();
  return ref;
}

async function registerReferral({ referrerId, referredSellerId }) {
  if (!referrerId || !referredSellerId) return null;
  if (String(referrerId) === String(referredSellerId)) return null;
  const existing = await Referral.findOne({ referredSeller: referredSellerId });
  if (existing) return existing;
  return Referral.create({ referrer: referrerId, referredSeller: referredSellerId });
}

async function dashboard(userId) {
  const refs = await Referral.find({ referrer: userId })
    .populate('referredSeller', 'name shopName avatar createdAt');
  const totalCashback = refs.reduce((s, r) => s + r.cashbackPaidTotal, 0);
  const qualified = refs.filter((r) => r.status === 'qualified').length;
  return { referrals: refs, totalCashback, qualifiedCount: qualified, pending: refs.length - qualified };
}

module.exports = { recordSellerSale, registerReferral, dashboard, GMV_THRESHOLD };
