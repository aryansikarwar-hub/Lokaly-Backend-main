/**
 * seedGlasses.js — One-time seed script to add 3 AR try-on glasses products.
 *
 * USAGE:
 *   1. Place this file in your backend root folder (same level as server.js / package.json)
 *   2. Make sure your .env has MONGODB_URI (or MONGO_URI) set
 *   3. Run: node seedGlasses.js
 *   4. Copy the printed _id values into ARTryOn.jsx (instructions printed at end)
 *
 * Safe to run multiple times — checks if products already exist by slug.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('./models/Product');
const User = require('./models/User');

// Read connection string from common env var names
const MONGO_URI =
  process.env.MONGODB_URI ||
  process.env.MONGO_URI ||
  process.env.DB_URI ||
  process.env.DATABASE_URL;

if (!MONGO_URI) {
  console.error('\n❌ No MongoDB connection string found in .env');
  console.error('   Expected one of: MONGODB_URI, MONGO_URI, DB_URI, DATABASE_URL\n');
  process.exit(1);
}

const GLASSES = [
  {
    slug: 'ar-aviator-lenskart-air',
    title: 'Aviator Sunglasses — Lenskart Air',
    description:
      'Classic teardrop aviators with a featherlight gold-tone metal frame. Polarized UV400 lenses cut glare for sharper vision in bright light. Perfect for road trips, beach days, and that effortless everyday look.',
    category: 'Eyewear',
    tags: ['sunglasses', 'aviator', 'lenskart', 'unisex', 'polarized'],
    price: 1499,
    compareAtPrice: 2299,
    stock: 50,
    images: [
      {
        url: 'https://images.unsplash.com/photo-1511499767150-a48a237f0083?w=800&q=80',
        publicId: 'ar_aviator_main',
      },
      {
        url: 'https://images.unsplash.com/photo-1572635196237-14b3f281503f?w=800&q=80',
        publicId: 'ar_aviator_alt',
      },
    ],
    attributes: {
      color: 'Gold',
      shape: 'Aviator',
      material: 'Metal',
      lens: 'Polarized UV400',
      gender: 'Unisex',
    },
  },
  {
    slug: 'ar-wayfarer-rayban-classic',
    title: 'Wayfarer Sunglasses — Ray-Ban Classic',
    description:
      'The iconic Wayfarer silhouette — bold acetate frame with deep black lenses. A timeless piece that has shaped style for decades. Comfortable, durable, and instantly recognizable.',
    category: 'Eyewear',
    tags: ['sunglasses', 'wayfarer', 'rayban', 'classic', 'unisex'],
    price: 2499,
    compareAtPrice: 3499,
    stock: 35,
    images: [
      {
        url: 'https://images.unsplash.com/photo-1473496169904-658ba7c44d8a?w=800&q=80',
        publicId: 'ar_wayfarer_main',
      },
      {
        url: 'https://images.unsplash.com/photo-1577803645773-f96470509666?w=800&q=80',
        publicId: 'ar_wayfarer_alt',
      },
    ],
    attributes: {
      color: 'Black',
      shape: 'Wayfarer',
      material: 'Acetate',
      lens: 'UV400',
      gender: 'Unisex',
    },
  },
  {
    slug: 'ar-cateye-vincent-chase',
    title: 'Cat-eye Sunglasses — Vincent Chase',
    description:
      'Statement cat-eye frame with a soft purple gradient lens. The pointed corners add elegant lift to your features. Lightweight, hypoallergenic, and ready for the spotlight.',
    category: 'Eyewear',
    tags: ['sunglasses', 'cat-eye', 'vincent-chase', 'women', 'fashion'],
    price: 1299,
    compareAtPrice: 1999,
    stock: 40,
    images: [
      {
        url: 'https://images.unsplash.com/photo-1556306535-0f09a537f0a3?w=800&q=80',
        publicId: 'ar_cateye_main',
      },
      {
        url: 'https://images.unsplash.com/photo-1574258495973-f010dfbb5371?w=800&q=80',
        publicId: 'ar_cateye_alt',
      },
    ],
    attributes: {
      color: 'Purple',
      shape: 'Cat-eye',
      material: 'Acetate',
      lens: 'Gradient UV400',
      gender: 'Women',
    },
  },
];

async function getOrCreateSeller() {
  // Try to find any existing user — prefer admin/seller-ish ones first
  let seller = await User.findOne({
    $or: [
      { role: 'seller' },
      { role: 'admin' },
      { isVerifiedSeller: true },
    ],
  });

  if (seller) {
    console.log(`✓ Using existing seller: ${seller.name || seller.email} (${seller._id})`);
    return seller;
  }

  // Fallback: any user
  seller = await User.findOne({});
  if (seller) {
    console.log(`✓ Using existing user as seller: ${seller.name || seller.email} (${seller._id})`);
    return seller;
  }

  // Last resort: create a demo Lokaly seller account
  console.log('⚠ No users in database — creating a demo seller "Lokaly Eyewear"…');
  const demo = await User.create({
    name: 'Lokaly Eyewear',
    email: 'eyewear@lokaly.demo',
    // Some User schemas require password; provide a random non-login one.
    // It will be hashed if your schema has a pre-save hook.
    password: 'demo_' + Math.random().toString(36).slice(2),
    isVerifiedSeller: true,
    shopName: 'Lokaly Eyewear',
    location: { city: 'Mumbai' },
    trustScore: 92,
  }).catch((err) => {
    console.error('\n❌ Could not create demo seller. Your User schema needs different fields.');
    console.error('   Error:', err.message);
    console.error('\n💡 Fix: open seedGlasses.js, find getOrCreateSeller(),');
    console.error('   and adjust the User.create({...}) fields to match your schema.\n');
    process.exit(1);
  });
  console.log(`✓ Created demo seller (${demo._id})`);
  return demo;
}

(async () => {
  console.log('\n🔌 Connecting to MongoDB…');
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✓ Connected\n');
  } catch (err) {
    console.error('❌ Connection failed:', err.message);
    process.exit(1);
  }

  const seller = await getOrCreateSeller();

  const results = [];
  for (const g of GLASSES) {
    const existing = await Product.findOne({ slug: g.slug });
    if (existing) {
      console.log(`↻ Already exists: ${g.title}`);
      results.push({ ...g, _id: existing._id, existed: true });
      continue;
    }
    const created = await Product.create({ ...g, seller: seller._id });
    console.log(`✓ Created: ${g.title}`);
    results.push({ ...g, _id: created._id, existed: false });
  }

  console.log('\n' + '═'.repeat(64));
  console.log('🎉 SEED COMPLETE — Copy these IDs into ARTryOn.jsx');
  console.log('═'.repeat(64));
  console.log('\nIn ARTryOn.jsx, find the FRAMES object and update productId:\n');
  console.log('const FRAMES = {');
  results.forEach((r, i) => {
    const key =
      r.slug.includes('aviator')
        ? 'aviator'
        : r.slug.includes('wayfarer')
        ? 'round'
        : 'cat-eye';
    console.log(`  "${key}": {`);
    console.log(`    productId: "${r._id}",  // <-- ${r.title}`);
    console.log(`    ...`);
    console.log(`  }${i < results.length - 1 ? ',' : ''}`);
  });
  console.log('};\n');

  console.log('Or in compact form:\n');
  console.log('  Aviator   → ' + results[0]._id);
  console.log('  Wayfarer  → ' + results[1]._id);
  console.log('  Cat-eye   → ' + results[2]._id);
  console.log('\n' + '═'.repeat(64) + '\n');

  await mongoose.disconnect();
  process.exit(0);
})();