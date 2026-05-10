/* eslint-disable no-console */
/**
 * Manual verification for the new stress radar signals.
 *
 *   node scripts/verifyStressRadar.js
 *
 * What it does:
 *   1. Connects to MongoDB
 *   2. Creates a synthetic seller + 3 products + 5 reviews
 *   3. Drives stock 5→0→5 cycles to populate stockoutHistory
 *   4. Calls computeStress and prints signals
 *   5. Cleans up the synthetic data
 *
 * Asserts (loud failure if either signal goes missing):
 *   - stockout_frequency present
 *   - bad_reviews present
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { connectDB } = require('../src/config/db');
const Product = require('../src/models/Product');
const Review = require('../src/models/Review');
const User = require('../src/models/User');
const { computeStress } = require('../src/services/stressService');

const TAG = '__stress_verify__';

async function cleanup(sellerId) {
  if (!sellerId) return;
  await Review.deleteMany({ seller: sellerId });
  await Product.deleteMany({ seller: sellerId });
  await User.deleteOne({ _id: sellerId });
}

async function main() {
  await connectDB();

  let sellerId = null;
  try {
    // 1. Synthetic seller
    const seller = await User.create({
      name: TAG,
      email: `${Date.now()}@${TAG}.dev`,
      passwordHash: 'unused_test_hash',
      role: 'seller',
    });
    sellerId = seller._id;
    console.log(`Created seller ${sellerId}`);

    // 2. Three products. Drive stock through 5 → 0 → 5 → 0 → 5 cycles
    //    to seed stockoutHistory through the pre-save hook.
    const products = [];
    for (let i = 0; i < 3; i += 1) {
      const p = await Product.create({
        seller: sellerId,
        title: `${TAG} item ${i}`,
        description: 'verify only',
        category: 'Test',
        price: 100 + i * 50,
        stock: 5,
      });
      products.push(p);
    }

    // For one product, drive 4 stockout cycles. For another, leave one open.
    for (let cycle = 0; cycle < 4; cycle += 1) {
      products[0].stock = 0;
      await products[0].save();
      products[0].stock = 5;
      await products[0].save();
    }
    products[1].stock = 0;
    await products[1].save();
    // products[2] stays in stock

    // Reload to inspect
    const p0 = await Product.findById(products[0]._id).lean();
    console.log(
      `Product[0] stockoutHistory length=${p0.stockoutHistory?.length || 0} ` +
        `(closed=${(p0.stockoutHistory || []).filter((e) => e.closedAt).length})`,
    );

    // Drive a 5th stockout (so total events for seller >= 5)
    products[0].stock = 0;
    await products[0].save();

    const freq = await Product.stockoutFrequency(sellerId, 30);
    console.log('stockoutFrequency:', freq);

    // 3. Five reviews with mostly negative ratings
    const ratings = [1, 2, 2, 5, 1];
    const sents = ['NEGATIVE', 'NEGATIVE', 'NEGATIVE', 'POSITIVE', 'NEGATIVE'];
    for (let i = 0; i < ratings.length; i += 1) {
      // Each review needs a unique buyer (unique index buyer+product)
      const buyer = await User.create({
        name: `${TAG}_buyer_${i}`,
        email: `${Date.now()}_${i}@${TAG}.dev`,
        passwordHash: 'unused',
        role: 'buyer',
      });
      await Review.create({
        buyer: buyer._id,
        seller: sellerId,
        product: products[i % products.length]._id,
        rating: ratings[i],
        text: sents[i] === 'NEGATIVE' ? 'terrible experience, would not recommend' : 'great',
        sentiment: { label: sents[i], score: 0.95 },
      });
    }

    // 4. Compute stress and inspect
    const out = await computeStress(sellerId);
    console.log('\n=== computeStress output ===');
    console.log(JSON.stringify(out, null, 2));

    const keys = out.signals.map((s) => s.key);
    const has = (k) => keys.includes(k);

    let pass = true;
    if (!has('stockout_frequency')) {
      console.error('FAIL: stockout_frequency signal missing');
      pass = false;
    }
    if (!has('bad_reviews')) {
      console.error('FAIL: bad_reviews signal missing');
      pass = false;
    }
    if (!has('stockouts')) {
      console.error('NOTE: stockouts (the existing simple one) also missing');
    }
    console.log(pass ? '\n✅ PASS' : '\n❌ FAIL');
    process.exitCode = pass ? 0 : 1;
  } catch (err) {
    console.error('VERIFY ERROR', err);
    process.exitCode = 1;
  } finally {
    if (sellerId) {
      await User.deleteMany({ name: { $regex: `^${TAG}` } });
      await Review.deleteMany({ seller: sellerId });
      await Product.deleteMany({ seller: sellerId });
      console.log('cleanup done');
    }
    await mongoose.disconnect();
  }
}

main();
