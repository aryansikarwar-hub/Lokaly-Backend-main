/* eslint-disable no-console */
/**
 * Lokaly seed script — creates a rich Indian social-commerce dataset.
 *
 * Run:   npm run seed
 * Drops: nothing (idempotent-ish — clears collections first when CLEAR=1)
 */

const mongoose = require('mongoose');
const env = require('./config/env');
const { connectDB } = require('./config/db');

const User = require('./models/User');
const Product = require('./models/Product');
const Post = require('./models/Post');
const LiveSession = require('./models/LiveSession');
const Review = require('./models/Review');
const Order = require('./models/Order');
const Referral = require('./models/Referral');
const Conversation = require('./models/Conversation');
const Message = require('./models/Message');
const CoinLedger = require('./models/CoinLedger');

// ---------- Indian seed pools ----------

const INDIAN_FIRST = [
  'Aarav', 'Vivaan', 'Aditya', 'Arjun', 'Vihaan', 'Sai', 'Ishaan', 'Ayaan', 'Krishna', 'Rohan',
  'Saanvi', 'Aanya', 'Diya', 'Ananya', 'Kavya', 'Myra', 'Aadhya', 'Pari', 'Anika', 'Ira',
  'Rahul', 'Priya', 'Neha', 'Rohit', 'Pooja', 'Sneha', 'Karthik', 'Meera', 'Rajesh', 'Deepika',
];
const INDIAN_LAST = [
  'Sharma', 'Verma', 'Patel', 'Iyer', 'Reddy', 'Khan', 'Singh', 'Mehta', 'Nair', 'Gupta',
  'Bose', 'Das', 'Rao', 'Pillai', 'Joshi', 'Kulkarni', 'Agarwal', 'Kapoor', 'Chopra', 'Banerjee',
];

const CITIES = [
  { city: 'Mumbai', state: 'Maharashtra', pincode: '400001', geo: [72.8777, 19.0760] },
  { city: 'Delhi', state: 'Delhi', pincode: '110001', geo: [77.1025, 28.7041] },
  { city: 'Bengaluru', state: 'Karnataka', pincode: '560001', geo: [77.5946, 12.9716] },
  { city: 'Hyderabad', state: 'Telangana', pincode: '500001', geo: [78.4867, 17.3850] },
  { city: 'Chennai', state: 'Tamil Nadu', pincode: '600001', geo: [80.2707, 13.0827] },
  { city: 'Kolkata', state: 'West Bengal', pincode: '700001', geo: [88.3639, 22.5726] },
  { city: 'Pune', state: 'Maharashtra', pincode: '411001', geo: [73.8567, 18.5204] },
  { city: 'Ahmedabad', state: 'Gujarat', pincode: '380001', geo: [72.5714, 23.0225] },
  { city: 'Jaipur', state: 'Rajasthan', pincode: '302001', geo: [75.7873, 26.9124] },
  { city: 'Lucknow', state: 'Uttar Pradesh', pincode: '226001', geo: [80.9462, 26.8467] },
  { city: 'Kochi', state: 'Kerala', pincode: '682001', geo: [76.2673, 9.9312] },
  { city: 'Surat', state: 'Gujarat', pincode: '395001', geo: [72.8311, 21.1702] },
];

const SHOP_CATEGORIES = [
  'Handloom & Sarees', 'Jewellery', 'Spices & Pickles', 'Home Decor', 'Ethnic Wear',
  'Organic Groceries', 'Leather & Mojaris', 'Pottery & Ceramics', 'Ayurveda & Wellness',
  'Indie Beauty', 'Bambooware', 'Street Food', 'Kids Toys (Channapatna)', 'Blue Pottery', 'Madhubani Art',
];

const SHOP_NAME_PARTS = {
  prefix: ['Rang', 'Dhaaga', 'Anaar', 'Chai', 'Laddu', 'Bazaar', 'Maati', 'Khadi', 'Mehendi', 'Naksha'],
  suffix: ['Kart', 'Chowk', 'Gully', 'Ghar', 'Dukan', 'Bazaar', 'Stories', 'Studio', 'Collective', 'Bazar'],
};

const PRODUCT_TEMPLATES = [
  // Handloom & Sarees
  { cat: 'Handloom & Sarees', items: [
    { title: 'Banarasi Silk Saree - Red Zari', price: 4899, tags: ['saree', 'silk', 'banarasi', 'wedding'] },
    { title: 'Kanjeevaram Pure Silk - Peacock Blue', price: 12500, tags: ['kanjeevaram', 'silk', 'south indian'] },
    { title: 'Chanderi Cotton Saree - Pastel Pink', price: 1899, tags: ['chanderi', 'cotton', 'casual'] },
    { title: 'Patola Double Ikat - Gujarat', price: 18999, tags: ['patola', 'ikat', 'gujarat'] },
    { title: 'Bandhani Dupatta - Rajasthan', price: 899, tags: ['bandhani', 'dupatta', 'rajasthan'] },
  ]},
  // Jewellery
  { cat: 'Jewellery', items: [
    { title: 'Oxidized Silver Jhumkas', price: 549, tags: ['earrings', 'jhumka', 'silver'] },
    { title: 'Kundan Choker Necklace Set', price: 2299, tags: ['kundan', 'necklace', 'bridal'] },
    { title: 'Meenakari Bangle Stack (Set of 6)', price: 699, tags: ['meenakari', 'bangles'] },
    { title: 'Temple Jewellery Pendant', price: 1599, tags: ['temple', 'pendant', 'traditional'] },
  ]},
  // Spices & Pickles
  { cat: 'Spices & Pickles', items: [
    { title: 'Homemade Aam ka Achaar (500g)', price: 299, tags: ['achaar', 'mango', 'homemade'] },
    { title: 'Kashmiri Red Chilli Powder (250g)', price: 189, tags: ['chilli', 'kashmiri', 'masala'] },
    { title: 'Garam Masala Blend - Grandma\'s Recipe', price: 149, tags: ['garam masala', 'spice'] },
    { title: 'Nolen Gur (Date Palm Jaggery) 500g', price: 349, tags: ['jaggery', 'bengali', 'winter'] },
  ]},
  // Home Decor
  { cat: 'Home Decor', items: [
    { title: 'Brass Diya Set (12 pieces)', price: 799, tags: ['brass', 'diya', 'diwali', 'puja'] },
    { title: 'Madhubani Painting on Canvas 16x20', price: 1899, tags: ['madhubani', 'painting', 'art'] },
    { title: 'Terracotta Wall Mask - Bastar', price: 499, tags: ['terracotta', 'bastar', 'tribal'] },
    { title: 'Jaipur Block Print Cushion Cover', price: 349, tags: ['block print', 'jaipur', 'cushion'] },
  ]},
  // Ethnic Wear
  { cat: 'Ethnic Wear', items: [
    { title: 'Chikankari Anarkali Kurta - Lucknow', price: 2499, tags: ['chikankari', 'kurta', 'lucknow'] },
    { title: 'Ikkat Cotton Dupatta - Pochampally', price: 599, tags: ['ikkat', 'dupatta', 'pochampally'] },
    { title: 'Kurta Pajama - Khadi Cotton Off White', price: 1199, tags: ['kurta', 'khadi', 'mens'] },
  ]},
  // Organic Groceries
  { cat: 'Organic Groceries', items: [
    { title: 'Cold-pressed Coconut Oil (1L)', price: 449, tags: ['organic', 'coconut', 'oil'] },
    { title: 'A2 Desi Cow Ghee (500g)', price: 899, tags: ['ghee', 'a2', 'desi cow'] },
    { title: 'Himalayan Pink Rock Salt (1kg)', price: 129, tags: ['salt', 'himalayan', 'organic'] },
  ]},
  // Leather & Mojaris
  { cat: 'Leather & Mojaris', items: [
    { title: 'Rajasthani Mojari - Embroidered', price: 999, tags: ['mojari', 'jutti', 'rajasthan'] },
    { title: 'Kolhapuri Chappal - Pure Leather', price: 749, tags: ['kolhapuri', 'chappal'] },
  ]},
  // Pottery & Ceramics
  { cat: 'Pottery & Ceramics', items: [
    { title: 'Khurja Ceramic Dinner Plate Set', price: 1499, tags: ['khurja', 'ceramic', 'kitchen'] },
    { title: 'Blue Pottery Vase - Jaipur', price: 1299, tags: ['blue pottery', 'jaipur', 'vase'] },
  ]},
  // Ayurveda & Wellness
  { cat: 'Ayurveda & Wellness', items: [
    { title: 'Ashwagandha Churna (200g)', price: 329, tags: ['ashwagandha', 'ayurveda'] },
    { title: 'Chyawanprash - Homemade (500g)', price: 499, tags: ['chyawanprash', 'immunity'] },
    { title: 'Neem Tulsi Face Wash', price: 249, tags: ['neem', 'tulsi', 'face wash'] },
  ]},
  // Indie Beauty
  { cat: 'Indie Beauty', items: [
    { title: 'Kumkumadi Tailam - Natural Glow Oil', price: 699, tags: ['kumkumadi', 'beauty'] },
    { title: 'Henna Hair Pack - Pure', price: 199, tags: ['henna', 'hair'] },
  ]},
  // Kids Toys (Channapatna)
  { cat: 'Kids Toys (Channapatna)', items: [
    { title: 'Channapatna Wooden Train (Safe Lacquer)', price: 899, tags: ['channapatna', 'wooden', 'toys'] },
    { title: 'Handcrafted Spinning Top Set', price: 349, tags: ['toys', 'traditional'] },
  ]},
  // Madhubani Art
  { cat: 'Madhubani Art', items: [
    { title: 'Hand-painted Madhubani Fridge Magnets (Set of 4)', price: 399, tags: ['madhubani', 'gift'] },
    { title: 'Mithila Art Tote Bag - Cotton', price: 499, tags: ['mithila', 'tote', 'bag'] },
  ]},
];

const HINDI_CAPTIONS = [
  'Naya stock! Seedha karigar se ❤️ #HandmadeInIndia',
  'Festive ready ho? Aaj ke naye drops dekhlo 🪔',
  'Meri maa ki recipe se banaya — taste ekdum ghar wala #desi',
  'Shaadi ke season me ye must-have hai 💃',
  'Only 5 pieces left — jaldi karo! ⏰',
  'Live kal shaam 7 baje — flash deals aur spin the wheel 🎡',
  'Chai pe charcha with our lovely customers today ☕',
  'Handmade love from Jaipur 💖 #VocalForLocal',
  'Unboxing this beauty from our Karigar in Varanasi 🎁',
  'Ma ki haath ka achaar — ab aap ke ghar tak 🥭',
];

const POST_EMOJIS = ['✨', '❤️', '🪔', '🧵', '🎨', '🛍️', '🌸', '🕉️'];

// ---------- helpers ----------
const rand = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rand(arr.length)];
const range = (n) => Array.from({ length: n }, (_, i) => i);

async function clearAll() {
  await Promise.all([
    User.deleteMany({}),
    Product.deleteMany({}),
    Post.deleteMany({}),
    LiveSession.deleteMany({}),
    Review.deleteMany({}),
    Order.deleteMany({}),
    Referral.deleteMany({}),
    Conversation.deleteMany({}),
    Message.deleteMany({}),
    CoinLedger.deleteMany({}),
  ]);
  console.log('[seed] cleared all collections');
}

async function seed() {
  await connectDB();
  if (process.env.CLEAR !== '0') await clearAll();

  // ---- sellers ----
  console.log('[seed] creating 20 Indian sellers...');
  const sellers = [];
  for (let i = 0; i < 20; i++) {
    const name = `${pick(INDIAN_FIRST)} ${pick(INDIAN_LAST)}`;
    const city = pick(CITIES);
    const shopName = `${pick(SHOP_NAME_PARTS.prefix)} ${pick(SHOP_NAME_PARTS.suffix)}`;
    const category = pick(SHOP_CATEGORIES);
    const seller = await User.create({
      name,
      email: `seller${i + 1}@lokaly.in`,
      passwordHash: 'password123',
      role: 'seller',
      shopName,
      shopCategory: category,
      isVerifiedSeller: Math.random() > 0.3,
      avatar: `https://i.pravatar.cc/200?u=seller${i + 1}`,
      bio: `${category} direct from ${city.city}. Supporting local artisans and karigars since 2018.`,
      phone: `+919${Math.floor(100000000 + Math.random() * 900000000)}`,
      location: {
        city: city.city, state: city.state, pincode: city.pincode,
        geo: { type: 'Point', coordinates: city.geo },
      },
      language: ['en', 'hi', 'ta', 'bn', 'gu'][rand(5)],
      trustScore: 50 + rand(50),
      fraudKarma: 50 + rand(50),
      coins: rand(500),
    });
    sellers.push(seller);
  }

  // ---- buyers ----
  console.log('[seed] creating 40 Indian buyers...');
  const buyers = [];
  for (let i = 0; i < 40; i++) {
    const name = `${pick(INDIAN_FIRST)} ${pick(INDIAN_LAST)}`;
    const city = pick(CITIES);
    const buyer = await User.create({
      name,
      email: `buyer${i + 1}@lokaly.in`,
      passwordHash: 'password123',
      role: 'buyer',
      avatar: `https://i.pravatar.cc/200?u=buyer${i + 1}`,
      phone: `+919${Math.floor(100000000 + Math.random() * 900000000)}`,
      location: {
        city: city.city, state: city.state, pincode: city.pincode,
        geo: { type: 'Point', coordinates: city.geo },
      },
      language: ['en', 'hi', 'ta', 'bn'][rand(4)],
      trustScore: 60 + rand(40),
      fraudKarma: 60 + rand(40),
      coins: rand(300),
    });
    buyers.push(buyer);
  }

  // ---- admin + demo accounts ----
  const admin = await User.create({
    name: 'Lokaly Admin',
    email: 'admin@lokaly.in',
    passwordHash: 'admin123',
    role: 'admin',
    avatar: 'https://i.pravatar.cc/200?u=admin',
    isVerifiedSeller: true,
  });
  const demoBuyer = await User.create({
    name: 'Demo Buyer (Priya)',
    email: 'demo@lokaly.in',
    passwordHash: 'demo1234',
    role: 'buyer',
    avatar: 'https://i.pravatar.cc/200?u=demo',
    location: { city: 'Mumbai', state: 'Maharashtra', pincode: '400001', geo: { type: 'Point', coordinates: [72.8777, 19.0760] } },
    language: 'hi',
    coins: 250,
  });
  const demoSeller = await User.create({
    name: 'Demo Seller (Rajesh)',
    email: 'shop@lokaly.in',
    passwordHash: 'demo1234',
    role: 'seller',
    shopName: 'Rang Bazaar',
    shopCategory: 'Handloom & Sarees',
    isVerifiedSeller: true,
    avatar: 'https://i.pravatar.cc/200?u=demoseller',
    bio: 'Featured demo shop — handwoven sarees direct from Varanasi.',
    location: { city: 'Varanasi', state: 'Uttar Pradesh', pincode: '221001', geo: { type: 'Point', coordinates: [82.9739, 25.3176] } },
    trustScore: 92, fraudKarma: 95, coins: 420,
  });
  sellers.push(demoSeller);
  buyers.push(demoBuyer);

  // ---- products (>=100) ----
  console.log('[seed] creating 100+ products...');
  const products = [];
  for (const tpl of PRODUCT_TEMPLATES) {
    const sellerPool = sellers.filter((s) => s.shopCategory === tpl.cat);
    const pool = sellerPool.length ? sellerPool : sellers;
    for (const item of tpl.items) {
      for (let k = 0; k < 2; k++) {
        const seller = pick(pool);
        const variant = k === 0 ? '' : ' (Premium)';
        const p = await Product.create({
          seller: seller._id,
          title: item.title + variant,
          description: `${item.title}${variant}. Handpicked from ${seller.location.city}, crafted by local artisans. Free delivery above ₹999 across India. 7-day easy returns.`,
          category: tpl.cat,
          tags: item.tags,
          price: k === 0 ? item.price : Math.round(item.price * 1.35),
          compareAtPrice: k === 0 ? Math.round(item.price * 1.2) : Math.round(item.price * 1.6),
          stock: 5 + rand(50),
          images: [
            { url: `https://picsum.photos/seed/${encodeURIComponent(item.title + k)}/600/800`, publicId: `seed-${item.title}-${k}` },
            { url: `https://picsum.photos/seed/${encodeURIComponent(item.title + 'b' + k)}/600/900`, publicId: `seed-${item.title}-b${k}` },
          ],
          rating: 3.5 + Math.random() * 1.5,
          reviewCount: rand(200),
          salesCount: rand(500),
          isFlashDeal: Math.random() > 0.85,
          flashDealEndsAt: new Date(Date.now() + (1 + rand(6)) * 3600 * 1000),
        });
        products.push(p);
      }
    }
  }

  // ---- posts (50+) ----
  console.log('[seed] creating social feed posts...');
  for (let i = 0; i < 60; i++) {
    const seller = pick(sellers);
    const caption = pick(HINDI_CAPTIONS) + ' ' + pick(POST_EMOJIS);
    const tagged = products.filter((p) => String(p.seller) === String(seller._id)).slice(0, 2);
    await Post.create({
      author: seller._id,
      kind: ['photo', 'video', 'reel'][rand(3)],
      caption,
      media: [{
        url: `https://picsum.photos/seed/post${i}/600/${600 + rand(400)}`,
        publicId: `post-${i}`,
        kind: 'image',
      }],
      taggedProducts: tagged.map((t) => t._id),
      hashtags: ['handmadeinindia', 'vocalforlocal', 'desi', 'indianartisan'].slice(0, 2 + rand(2)),
      likes: buyers.slice(0, 5 + rand(20)).map((b) => b._id),
    });
  }

  // ---- live sessions (10) ----
  console.log('[seed] creating live sessions...');
  const liveTitles = [
    'Diwali Saree Drops — Live from Banaras 🪔',
    'Wedding Jewellery Haul + Spin the Wheel 💎',
    'Maa ke Haath ka Achaar Reveal 🥭',
    'Jaipur Block Print Dupatta Flash Sale ⚡',
    'Handloom Chanderi Cotton Showcase 🌸',
    'Kolhapuri Chappal Fresh Stock — Size Guide',
    'Chikankari Lucknow Live — Festive Collection',
    'Madhubani Art Live Painting Demo 🎨',
    'Ayurveda Winter Wellness Bundle',
    'Brass Diya + Puja Thali — Diwali Essentials',
  ];
  for (let i = 0; i < 10; i++) {
    const host = pick(sellers);
    const featured = products.filter((p) => String(p.seller) === String(host._id)).slice(0, 4);
    const isLive = i < 4;
    await LiveSession.create({
      host: host._id,
      title: liveTitles[i],
      description: 'Featured drops, flash deals, and spin-the-wheel rewards. Ask questions in chat — we answer live!',
      coverImage: `https://picsum.photos/seed/live${i}/1200/675`,
      category: host.shopCategory,
      status: isLive ? 'live' : 'scheduled',
      scheduledAt: isLive ? undefined : new Date(Date.now() + (1 + i) * 3600 * 1000),
      startedAt: isLive ? new Date(Date.now() - rand(30) * 60000) : undefined,
      streamKey: 'demo-key-' + i,
      roomId: `live_demo_${i}`,
      featuredProducts: featured.map((f) => f._id),
      groupBuy: { threshold: 10, discountPct: 15, participants: [], unlocked: false },
      stats: { peakViewers: rand(1200), totalViewers: rand(5000), reactions: rand(800), chatMessages: rand(300) },
    });
  }

  // ---- reviews (100+) ----
  console.log('[seed] seeding reviews...');
  const reviewTexts = [
    'Bohot hi accha product! Quality ekdum top class ✨',
    'Amazing handloom, fabric is soft and real silk feel',
    'Delivery was 2 days late but product is worth it',
    'My mom loved the saree — perfect for Diwali',
    'Not as bright as the picture, but still decent',
    'Packaging was beautiful, felt premium',
    'Spices are fresh and flavourful — reminded me of home',
    'Jhumkas broke within a week, had to request replacement',
    'Exactly as described, fit perfectly',
    'Seller was super responsive on chat — 10/10 service',
  ];
  for (let i = 0; i < 120; i++) {
    const buyer = pick(buyers);
    const product = pick(products);
    const text = pick(reviewTexts);
    await Review.create({
      buyer: buyer._id,
      seller: product.seller,
      product: product._id,
      rating: 1 + rand(5),
      text,
      sentiment: { label: text.includes('broke') || text.includes('late') ? 'NEGATIVE' : 'POSITIVE', score: 0.8 + Math.random() * 0.2 },
      isRepeatBuyer: Math.random() > 0.6,
    }).catch(() => null);
  }

  // ---- a few delivered orders to power trust/karma ----
  console.log('[seed] creating demo orders...');
  for (let i = 0; i < 30; i++) {
    const buyer = pick(buyers);
    const prod = pick(products);
    const seller = sellers.find((s) => String(s._id) === String(prod.seller));
    if (!seller) continue;
    const subtotal = prod.price;
    const shipping = subtotal > 999 ? 0 : 49;
    const status = Math.random() > 0.2 ? 'delivered' : 'shipped';
    await Order.create({
      buyer: buyer._id,
      items: [{ product: prod._id, seller: seller._id, title: prod.title, image: prod.images[0]?.url, quantity: 1, price: prod.price }],
      address: {
        fullName: buyer.name, phone: buyer.phone,
        line1: '42, MG Road', city: buyer.location.city, state: buyer.location.state, pincode: buyer.location.pincode,
        country: 'IN',
      },
      subtotal, shipping, total: subtotal + shipping,
      status,
      timeline: [
        { status: 'pending', note: 'Order placed', at: new Date(Date.now() - 7 * 86400000) },
        { status: 'paid', note: 'UPI payment received', at: new Date(Date.now() - 7 * 86400000 + 3600000) },
        { status: 'shipped', note: 'Handed to courier partner', at: new Date(Date.now() - 4 * 86400000) },
        ...(status === 'delivered' ? [{ status: 'delivered', note: 'Delivered safely', at: new Date(Date.now() - 1 * 86400000) }] : []),
      ],
      payment: { provider: 'razorpay-mock', paidAt: new Date(Date.now() - 7 * 86400000 + 3600000), mode: 'upi' },
    });
  }

  // ---- one demo conversation with FAQ-worthy banter ----
  const convo = await Conversation.between(demoBuyer._id, demoSeller._id);
  await Message.create([
    { conversation: convo._id, from: demoBuyer._id, to: demoSeller._id, text: 'Namaste! Is the Banarasi saree available in red?' },
    { conversation: convo._id, from: demoSeller._id, to: demoBuyer._id, text: 'Ji haan! Red zari Banarasi is in stock. Shipping is 2-3 days to Mumbai.' },
    { conversation: convo._id, from: demoBuyer._id, to: demoSeller._id, text: 'Return policy kya hai?' },
    { conversation: convo._id, from: demoSeller._id, to: demoBuyer._id, text: '7 days easy return, item should be unused with original tags.' },
  ]);
  convo.lastMessage = { text: '7 days easy return...', at: new Date(), from: demoSeller._id };
  await convo.save();

  console.log(`
[seed] ✨ Done!
  sellers: ${sellers.length}  buyers: ${buyers.length + 1}  products: ${products.length}
  admin: admin@lokaly.in / admin123
  demo buyer: demo@lokaly.in / demo1234
  demo seller: shop@lokaly.in / demo1234
  all seed accounts: seller{1..20}@lokaly.in / buyer{1..40}@lokaly.in  (password: password123)
`);
  await mongoose.disconnect();
}

seed().catch(async (err) => {
  console.error('[seed] FAILED', err);
  await mongoose.disconnect().catch(() => null);
  process.exit(1);
});
