/* eslint-disable no-console */
/**
 * seedDiverseProducts.js
 *
 * 150 diverse Indian products → Pexels (image search) → Cloudinary (re-upload)
 *                            → MongoDB Product docs.
 *
 * Why this exists:
 *   Most demo products in DB use deprecated `source.unsplash.com` URLs
 *   (Unsplash killed that endpoint mid-2024 — every image 404s now).
 *   This script seeds a fresh, image-rich catalog plus optionally fixes
 *   any existing broken images.
 *
 * Setup (one-time):
 *   1. Get a free Pexels API key from https://www.pexels.com/api/
 *   2. Add to .env:  PEXELS_API_KEY=<your-key>
 *   3. CLOUDINARY_* env vars must already be set (they are in this repo)
 *
 * Run:
 *   node scripts/seedDiverseProducts.js                   # add 150 new products
 *   node scripts/seedDiverseProducts.js --delete-broken   # delete existing products with broken image URLs
 *   node scripts/seedDiverseProducts.js --delete-broken --skip-seed   # only clean, no new seeding
 *   node scripts/seedDiverseProducts.js --limit=20        # smoke test with 20
 *
 * Notes:
 *   - Idempotent: skips products whose slug already exists.
 *   - Distributes new products across existing sellers (round-robin).
 *     If no sellers exist, creates one demo seller.
 *   - Pexels free tier: 200 req/hour — well within 150-product budget.
 *   - Cloudinary uploads go into folder  lokaly/seed/<slug>.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');
const { connectDB } = require('../src/config/db');
const { cloudinary, isConfigured } = require('../src/config/cloudinary');

const Product = require('../src/models/Product');
const User = require('../src/models/User');

const PEXELS_KEY = process.env.PEXELS_API_KEY;
const argv = process.argv.slice(2);
const DELETE_BROKEN = argv.includes('--delete-broken');
const SKIP_SEED = argv.includes('--skip-seed');
const LIMIT = Number((argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1]) || 0;

// ── Curated diverse Indian product catalog ──────────────────────────────
// Each entry: { title, category, price, tags, query (for Pexels), description? }
// query is the Pexels search term; tuned for results that actually exist.

const CITIES = [
  { city: 'Mumbai', pincode: '400001', geo: [72.8777, 19.076] },
  { city: 'Delhi', pincode: '110001', geo: [77.1025, 28.7041] },
  { city: 'Bengaluru', pincode: '560001', geo: [77.5946, 12.9716] },
  { city: 'Jaipur', pincode: '302001', geo: [75.7873, 26.9124] },
  { city: 'Kolkata', pincode: '700001', geo: [88.3639, 22.5726] },
  { city: 'Chennai', pincode: '600001', geo: [80.2707, 13.0827] },
  { city: 'Pune', pincode: '411001', geo: [73.8567, 18.5204] },
  { city: 'Hyderabad', pincode: '500001', geo: [78.4867, 17.385] },
  { city: 'Ahmedabad', pincode: '380001', geo: [72.5714, 23.0225] },
  { city: 'Kochi', pincode: '682001', geo: [76.2673, 9.9312] },
];

const CATALOG = [
  // ── Sarees (12) ──
  { title: 'Banarasi Silk Saree — Maroon', category: 'Handloom & Sarees', price: 4800, query: 'banarasi saree', tags: ['saree', 'silk', 'banarasi', 'handloom'] },
  { title: 'Kanjivaram Silk Saree — Gold border', category: 'Handloom & Sarees', price: 6200, query: 'kanjivaram saree', tags: ['saree', 'silk', 'kanjivaram'] },
  { title: 'Cotton Handloom Saree — Blue', category: 'Handloom & Sarees', price: 1450, query: 'cotton saree', tags: ['saree', 'cotton', 'handloom', 'blue'] },
  { title: 'Chanderi Silk Saree', category: 'Handloom & Sarees', price: 3200, query: 'chanderi saree', tags: ['saree', 'silk', 'chanderi'] },
  { title: 'Georgette Saree — Floral Print', category: 'Handloom & Sarees', price: 1899, query: 'georgette saree', tags: ['saree', 'georgette', 'floral'] },
  { title: 'Bandhani Saree — Gujarat', category: 'Handloom & Sarees', price: 1799, query: 'bandhani saree', tags: ['saree', 'bandhani', 'gujarat'] },
  { title: 'Patola Silk Saree', category: 'Handloom & Sarees', price: 7500, query: 'patola saree', tags: ['saree', 'silk', 'patola'] },
  { title: 'Linen Saree — Pastel Pink', category: 'Handloom & Sarees', price: 1599, query: 'linen saree pink', tags: ['saree', 'linen'] },
  { title: 'Chiffon Designer Saree', category: 'Handloom & Sarees', price: 2100, query: 'chiffon saree', tags: ['saree', 'chiffon', 'designer'] },
  { title: 'Tussar Silk Saree — Beige', category: 'Handloom & Sarees', price: 3400, query: 'tussar silk saree', tags: ['saree', 'silk', 'tussar'] },
  { title: 'Paithani Saree — Peacock motif', category: 'Handloom & Sarees', price: 5800, query: 'paithani saree', tags: ['saree', 'paithani', 'maharashtra'] },
  { title: 'Cotton Saree — Office Wear', category: 'Handloom & Sarees', price: 999, query: 'cotton saree office', tags: ['saree', 'cotton', 'casual'] },

  // ── Ethnic wear (12) ──
  { title: 'Anarkali Kurta — Mustard', category: 'Ethnic Wear', price: 1499, query: 'anarkali kurta', tags: ['kurta', 'ethnic', 'anarkali'] },
  { title: "Men's Kurta Pyjama — White", category: 'Ethnic Wear', price: 1299, query: 'mens kurta india', tags: ['kurta', 'menswear', 'ethnic'] },
  { title: 'Lehenga Choli — Bridal Red', category: 'Ethnic Wear', price: 12500, query: 'lehenga choli', tags: ['lehenga', 'bridal', 'wedding'] },
  { title: 'Salwar Kameez — Floral', category: 'Ethnic Wear', price: 1899, query: 'salwar kameez', tags: ['salwar', 'kameez', 'floral'] },
  { title: 'Nehru Jacket — Charcoal', category: 'Ethnic Wear', price: 1799, query: 'nehru jacket', tags: ['jacket', 'menswear', 'ethnic'] },
  { title: 'Sherwani — Cream & Gold', category: 'Ethnic Wear', price: 8500, query: 'sherwani indian', tags: ['sherwani', 'menswear', 'wedding'] },
  { title: 'Dupatta — Phulkari Embroidered', category: 'Ethnic Wear', price: 599, query: 'phulkari dupatta', tags: ['dupatta', 'phulkari', 'punjab'] },
  { title: 'Kurti — Hand Block Print', category: 'Ethnic Wear', price: 899, query: 'block print kurti', tags: ['kurti', 'cotton', 'block print'] },
  { title: 'Palazzo Pant Set', category: 'Ethnic Wear', price: 1099, query: 'palazzo pants india', tags: ['palazzo', 'ethnic'] },
  { title: 'Bandhgala Suit — Navy', category: 'Ethnic Wear', price: 9500, query: 'bandhgala suit', tags: ['suit', 'menswear', 'formal'] },
  { title: 'Sharara Set — Sea Green', category: 'Ethnic Wear', price: 3200, query: 'sharara set', tags: ['sharara', 'ethnic'] },
  { title: 'Indo-Western Gown', category: 'Ethnic Wear', price: 2899, query: 'indo western gown', tags: ['gown', 'indo-western'] },

  // ── Jewelry (12) ──
  { title: 'Kundan Choker Set', category: 'Jewelry', price: 3400, query: 'kundan necklace', tags: ['kundan', 'necklace', 'choker'] },
  { title: 'Oxidized Silver Earrings', category: 'Jewelry', price: 499, query: 'oxidized silver earrings', tags: ['silver', 'earrings', 'oxidized'] },
  { title: 'Temple Jewelry Necklace', category: 'Jewelry', price: 2899, query: 'temple jewelry', tags: ['temple', 'south indian', 'necklace'] },
  { title: 'Pearl Strand Necklace', category: 'Jewelry', price: 1899, query: 'pearl necklace', tags: ['pearl', 'necklace'] },
  { title: 'Polki Bridal Set', category: 'Jewelry', price: 18500, query: 'polki jewelry', tags: ['polki', 'bridal', 'necklace'] },
  { title: 'Glass Bangles — Stack Set', category: 'Jewelry', price: 299, query: 'indian bangles', tags: ['bangles', 'glass'] },
  { title: 'Jhumka Earrings — Brass', category: 'Jewelry', price: 599, query: 'jhumka earrings', tags: ['jhumka', 'earrings', 'brass'] },
  { title: 'Anklet — Silver Payal', category: 'Jewelry', price: 799, query: 'silver anklet', tags: ['anklet', 'payal', 'silver'] },
  { title: 'Maang Tikka — Antique Gold', category: 'Jewelry', price: 899, query: 'maang tikka', tags: ['tikka', 'bridal'] },
  { title: 'Nose Ring — Traditional', category: 'Jewelry', price: 349, query: 'nose ring india', tags: ['nose ring', 'silver'] },
  { title: 'Meenakari Pendant', category: 'Jewelry', price: 1099, query: 'meenakari jewelry', tags: ['meenakari', 'pendant'] },
  { title: 'Beaded Statement Necklace', category: 'Jewelry', price: 699, query: 'beaded necklace', tags: ['beads', 'necklace'] },

  // ── Handicrafts & Decor (15) ──
  { title: 'Blue Pottery Vase — Jaipur', category: 'Home Decor', price: 1299, query: 'blue pottery', tags: ['pottery', 'jaipur', 'handicraft'] },
  { title: 'Madhubani Painting — Wall', category: 'Home Decor', price: 2199, query: 'madhubani painting', tags: ['painting', 'madhubani', 'art'] },
  { title: 'Warli Art Canvas', category: 'Home Decor', price: 1599, query: 'warli art', tags: ['warli', 'painting', 'maharashtra'] },
  { title: 'Tanjore Painting — Krishna', category: 'Home Decor', price: 4500, query: 'tanjore painting', tags: ['tanjore', 'painting', 'tamil nadu'] },
  { title: 'Pattachitra Scroll', category: 'Home Decor', price: 1899, query: 'pattachitra', tags: ['pattachitra', 'odisha', 'painting'] },
  { title: 'Terracotta Wall Hanging', category: 'Home Decor', price: 799, query: 'terracotta wall', tags: ['terracotta', 'wall hanging'] },
  { title: 'Brass Diya Set — Pooja', category: 'Home Decor', price: 599, query: 'brass diya', tags: ['brass', 'diya', 'pooja'] },
  { title: 'Dhokra Tribal Figurine', category: 'Home Decor', price: 1399, query: 'dhokra art', tags: ['dhokra', 'tribal', 'metal'] },
  { title: 'Marble Inlay Coasters — Set of 4', category: 'Home Decor', price: 1299, query: 'marble inlay', tags: ['marble', 'agra', 'coaster'] },
  { title: 'Wooden Elephant — Sandalwood', category: 'Home Decor', price: 999, query: 'wooden elephant carving', tags: ['wooden', 'carving', 'elephant'] },
  { title: 'Jute Wall Macrame', category: 'Home Decor', price: 699, query: 'macrame wall', tags: ['jute', 'macrame', 'boho'] },
  { title: 'Hand Block Cushion Cover', category: 'Home Decor', price: 449, query: 'block print cushion', tags: ['cushion', 'block print'] },
  { title: 'Diwali Rangoli Stencil Kit', category: 'Home Decor', price: 299, query: 'rangoli', tags: ['diwali', 'rangoli'] },
  { title: 'Kashmiri Papier Mache Box', category: 'Home Decor', price: 899, query: 'papier mache', tags: ['kashmir', 'box'] },
  { title: 'Bidri Vase — Bidar', category: 'Home Decor', price: 2899, query: 'bidri', tags: ['bidri', 'metal', 'karnataka'] },

  // ── Food & Spices (12) ──
  { title: 'Basmati Rice — Premium 5kg', category: 'Food & Beverages', price: 899, query: 'basmati rice', tags: ['rice', 'basmati', 'grocery'] },
  { title: 'Turmeric Powder — Organic 500g', category: 'Food & Beverages', price: 199, query: 'turmeric', tags: ['turmeric', 'spice', 'organic'] },
  { title: 'Garam Masala — Hand-ground', category: 'Food & Beverages', price: 249, query: 'garam masala spice', tags: ['masala', 'spice'] },
  { title: 'Cow Ghee — A2 Desi 500ml', category: 'Food & Beverages', price: 599, query: 'ghee jar', tags: ['ghee', 'dairy'] },
  { title: 'Mango Pickle — Homemade', category: 'Food & Beverages', price: 199, query: 'mango pickle', tags: ['pickle', 'mango', 'achar'] },
  { title: 'Kaju Katli Box — 500g', category: 'Food & Beverages', price: 749, query: 'kaju katli', tags: ['sweets', 'mithai', 'cashew'] },
  { title: 'Khakhra — Methi Masala', category: 'Food & Beverages', price: 149, query: 'khakhra', tags: ['snack', 'gujarat'] },
  { title: 'Darjeeling First Flush Tea', category: 'Food & Beverages', price: 449, query: 'darjeeling tea', tags: ['tea', 'darjeeling'] },
  { title: 'Filter Coffee Powder — Mysore', category: 'Food & Beverages', price: 329, query: 'filter coffee', tags: ['coffee', 'south indian'] },
  { title: 'Saffron — Kashmiri 1g', category: 'Food & Beverages', price: 899, query: 'saffron kesar', tags: ['saffron', 'kesar', 'kashmir'] },
  { title: 'Papad — Lijjat Style 200g', category: 'Food & Beverages', price: 99, query: 'papad', tags: ['papad', 'snack'] },
  { title: 'Honey — Forest Wild 350g', category: 'Food & Beverages', price: 449, query: 'honey jar', tags: ['honey', 'organic'] },

  // ── Beauty & Wellness (10) ──
  { title: 'Henna — Natural Mehendi', category: 'Beauty & Wellness', price: 249, query: 'henna mehendi', tags: ['henna', 'mehendi'] },
  { title: 'Multani Mitti Face Pack', category: 'Beauty & Wellness', price: 199, query: 'face pack clay', tags: ['multani mitti', 'skincare'] },
  { title: 'Ayurvedic Hair Oil — Bhringraj', category: 'Beauty & Wellness', price: 349, query: 'hair oil bottle', tags: ['hair oil', 'ayurveda'] },
  { title: 'Kumkumadi Face Serum', category: 'Beauty & Wellness', price: 1299, query: 'face serum', tags: ['serum', 'ayurveda'] },
  { title: 'Sandalwood Soap — Mysore', category: 'Beauty & Wellness', price: 99, query: 'sandalwood soap', tags: ['soap', 'sandalwood'] },
  { title: 'Rose Water Toner', category: 'Beauty & Wellness', price: 199, query: 'rose water', tags: ['toner', 'rose'] },
  { title: 'Aloe Vera Gel — Pure', category: 'Beauty & Wellness', price: 249, query: 'aloe vera gel', tags: ['aloe vera', 'skincare'] },
  { title: 'Sindoor — Vermilion Powder', category: 'Beauty & Wellness', price: 149, query: 'sindoor', tags: ['sindoor', 'pooja'] },
  { title: 'Kajal — Kohl Stick', category: 'Beauty & Wellness', price: 199, query: 'kajal kohl', tags: ['kajal', 'makeup'] },
  { title: 'Body Scrub — Coffee & Coconut', category: 'Beauty & Wellness', price: 399, query: 'body scrub', tags: ['scrub', 'skincare'] },

  // ── Bags & Accessories (10) ──
  { title: 'Jute Tote Bag — Eco', category: 'Bags & Accessories', price: 449, query: 'jute bag', tags: ['jute', 'tote', 'eco'] },
  { title: 'Kolhapuri Leather Sandals', category: 'Footwear', price: 1199, query: 'kolhapuri chappal', tags: ['kolhapuri', 'leather', 'footwear'] },
  { title: 'Embroidered Mojari Juttis', category: 'Footwear', price: 999, query: 'jutti footwear', tags: ['jutti', 'mojari', 'footwear'] },
  { title: 'Banjara Embroidered Sling Bag', category: 'Bags & Accessories', price: 799, query: 'embroidered bag', tags: ['banjara', 'sling', 'embroidery'] },
  { title: 'Leather Wallet — Hand-stitched', category: 'Bags & Accessories', price: 1199, query: 'leather wallet', tags: ['wallet', 'leather'] },
  { title: 'Silk Scarf — Hand-painted', category: 'Bags & Accessories', price: 899, query: 'silk scarf', tags: ['scarf', 'silk'] },
  { title: 'Beaded Clutch — Bridal', category: 'Bags & Accessories', price: 1499, query: 'beaded clutch', tags: ['clutch', 'beaded', 'bridal'] },
  { title: 'Cane Hand Fan', category: 'Bags & Accessories', price: 149, query: 'hand fan', tags: ['cane', 'fan'] },
  { title: 'Leather Belt — Vintage', category: 'Bags & Accessories', price: 699, query: 'leather belt', tags: ['belt', 'leather'] },
  { title: 'Pashmina Shawl — Kashmir', category: 'Bags & Accessories', price: 3499, query: 'pashmina shawl', tags: ['shawl', 'pashmina', 'kashmir'] },

  // ── Kitchen & Utensils (8) ──
  { title: 'Copper Water Bottle — 1L', category: 'Kitchen & Dining', price: 599, query: 'copper bottle', tags: ['copper', 'bottle'] },
  { title: 'Brass Pooja Thali Set', category: 'Kitchen & Dining', price: 1299, query: 'pooja thali brass', tags: ['brass', 'pooja', 'thali'] },
  { title: 'Cast Iron Tawa — 12 inch', category: 'Kitchen & Dining', price: 899, query: 'iron tawa', tags: ['tawa', 'iron'] },
  { title: 'Mortar & Pestle — Stone', category: 'Kitchen & Dining', price: 499, query: 'mortar pestle', tags: ['stone', 'okhli'] },
  { title: 'Wooden Chakla Belan', category: 'Kitchen & Dining', price: 349, query: 'chakla belan wooden', tags: ['rolling pin', 'wooden'] },
  { title: 'Terracotta Earthen Pot', category: 'Kitchen & Dining', price: 299, query: 'clay pot', tags: ['terracotta', 'matka'] },
  { title: 'Stainless Steel Tiffin — 3 tier', category: 'Kitchen & Dining', price: 799, query: 'steel tiffin', tags: ['tiffin', 'steel'] },
  { title: 'Spice Box — Masala Dabba', category: 'Kitchen & Dining', price: 599, query: 'masala dabba', tags: ['spice box', 'steel'] },

  // ── Books, Music, Art (8) ──
  { title: 'Bhagavad Gita — Hardcover', category: 'Books', price: 349, query: 'bhagavad gita book', tags: ['book', 'gita'] },
  { title: 'Indian Cookbook — Regional', category: 'Books', price: 499, query: 'indian cookbook', tags: ['cookbook', 'book'] },
  { title: 'Sitar — Beginner Model', category: 'Music', price: 8499, query: 'sitar instrument', tags: ['sitar', 'music'] },
  { title: 'Tabla Set — Hand-tuned', category: 'Music', price: 4500, query: 'tabla', tags: ['tabla', 'percussion'] },
  { title: 'Harmonium — 3 Reed', category: 'Music', price: 12500, query: 'harmonium', tags: ['harmonium', 'music'] },
  { title: 'Bansuri Flute — Bamboo', category: 'Music', price: 599, query: 'bamboo flute', tags: ['bansuri', 'flute'] },
  { title: 'Yoga Sutras — Translation', category: 'Books', price: 299, query: 'yoga book', tags: ['yoga', 'book'] },
  { title: 'Vintage Bollywood Vinyl', category: 'Music', price: 1499, query: 'vinyl record', tags: ['vinyl', 'bollywood'] },

  // ── Sports & Outdoors (6) ──
  { title: 'Yoga Mat — Eco Jute', category: 'Sports', price: 1499, query: 'yoga mat', tags: ['yoga', 'fitness'] },
  { title: 'Cricket Bat — English Willow', category: 'Sports', price: 3499, query: 'cricket bat', tags: ['cricket', 'sports'] },
  { title: 'Badminton Racket Pair', category: 'Sports', price: 1299, query: 'badminton racket', tags: ['badminton', 'sports'] },
  { title: 'Football — Match Quality', category: 'Sports', price: 899, query: 'football ball', tags: ['football', 'sports'] },
  { title: 'Carrom Board — Tournament', category: 'Sports', price: 2499, query: 'carrom board', tags: ['carrom', 'board game'] },
  { title: 'Skipping Rope — Steel', category: 'Sports', price: 299, query: 'skipping rope', tags: ['fitness', 'rope'] },

  // ── Plants & Garden (5) ──
  { title: 'Tulsi Plant — Holy Basil', category: 'Plants & Garden', price: 199, query: 'tulsi plant', tags: ['plant', 'tulsi'] },
  { title: 'Money Plant — Pothos', category: 'Plants & Garden', price: 249, query: 'money plant', tags: ['plant', 'indoor'] },
  { title: 'Bonsai Ficus — 5 year', category: 'Plants & Garden', price: 1499, query: 'bonsai', tags: ['plant', 'bonsai'] },
  { title: 'Terracotta Planter Set', category: 'Plants & Garden', price: 449, query: 'terracotta planter', tags: ['planter', 'garden'] },
  { title: 'Marigold Seeds — Pack of 50', category: 'Plants & Garden', price: 99, query: 'marigold flower', tags: ['seeds', 'flower'] },

  // ── Toys & Stationery (6) ──
  { title: 'Channapatna Wooden Toy', category: 'Toys & Kids', price: 599, query: 'wooden toy', tags: ['channapatna', 'toy', 'wooden'] },
  { title: 'Wooden Spinning Top — Lattu', category: 'Toys & Kids', price: 149, query: 'spinning top', tags: ['toy', 'lattu'] },
  { title: 'Handmade Cloth Doll', category: 'Toys & Kids', price: 449, query: 'cloth doll', tags: ['doll', 'handmade'] },
  { title: 'Leather-bound Journal', category: 'Stationery', price: 699, query: 'leather journal', tags: ['journal', 'stationery'] },
  { title: 'Wax Seal Stamp Kit', category: 'Stationery', price: 899, query: 'wax seal', tags: ['stationery', 'wax'] },
  { title: 'Handmade Paper Notebook', category: 'Stationery', price: 249, query: 'handmade notebook', tags: ['paper', 'stationery'] },
];

// ── Helpers ─────────────────────────────────────────────────────────────

function slugify(s) {
  return String(s)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function pexelsSearch(query) {
  // No-key mode: picsum.photos returns a different stable nice photo per seed.
  // It's not category-matched but always works without auth.
  if (!PEXELS_KEY) {
    const seed = encodeURIComponent(`${query}-${Math.floor(Math.random() * 10000)}`);
    return `https://picsum.photos/seed/${seed}/800/800`;
  }
  try {
    const res = await axios.get('https://api.pexels.com/v1/search', {
      params: { query, per_page: 5, orientation: 'square' },
      headers: { Authorization: PEXELS_KEY },
      timeout: 15000,
    });
    const photos = res.data?.photos || [];
    if (photos.length === 0) {
      // Pexels returned no result for this query → fall back to picsum
      const seed = encodeURIComponent(`${query}-${Math.floor(Math.random() * 10000)}`);
      return `https://picsum.photos/seed/${seed}/800/800`;
    }
    const photo = pick(photos);
    return photo?.src?.large || photo?.src?.medium || photo?.src?.original;
  } catch (err) {
    // Rate-limit or transient error → picsum fallback so seeding doesn't break
    const seed = encodeURIComponent(`${query}-${Math.floor(Math.random() * 10000)}`);
    return `https://picsum.photos/seed/${seed}/800/800`;
  }
}

async function uploadToCloudinary(imageUrl, folder, publicId) {
  const result = await cloudinary.uploader.upload(imageUrl, {
    folder,
    public_id: publicId,
    overwrite: true,
    resource_type: 'image',
    transformation: [{ width: 800, height: 800, crop: 'limit', quality: 'auto' }],
  });
  return { url: result.secure_url, publicId: result.public_id };
}

async function getOrCreateSeller() {
  // Prefer existing verified sellers, fall back to any seller, else create one.
  let sellers = await User.find({ role: 'seller' }).select('_id shopName').limit(20).lean();
  if (sellers.length > 0) return sellers;
  console.log('[seed] No sellers found — creating a demo seller');
  const demo = await User.create({
    name: 'Lokaly Demo Seller',
    email: `demo-seller-${Date.now()}@lokaly.local`,
    passwordHash: 'demo-not-loginable',
    role: 'seller',
    shopName: 'Lokaly Curated',
    isVerifiedSeller: true,
  });
  return [demo];
}

async function seedOne(entry, sellers, index, total) {
  const slug = `${slugify(entry.title)}-seeded`;
  const exists = await Product.findOne({ slug }).select('_id').lean();
  if (exists) {
    console.log(`[${index}/${total}] ⊝ skip (exists): ${entry.title}`);
    return { skipped: true };
  }

  const imgUrl = await pexelsSearch(entry.query);
  if (!imgUrl) {
    console.log(`[${index}/${total}] ⚠ no Pexels image for "${entry.query}" — skipping`);
    return { failed: true };
  }

  const uploaded = await uploadToCloudinary(imgUrl, 'lokaly/seed', slug);
  const seller = sellers[index % sellers.length];
  const loc = pick(CITIES);

  await Product.create({
    seller: seller._id,
    title: entry.title,
    slug,
    description:
      entry.description ||
      `${entry.title} — curated by Lokaly. Authentic ${entry.tags.join(', ')}.`,
    category: entry.category,
    tags: entry.tags,
    price: entry.price,
    currency: 'INR',
    stock: 25 + Math.floor(Math.random() * 50),
    images: [uploaded],
    isActive: true,
    sellerLocation: {
      city: loc.city,
      pincode: loc.pincode,
      geo: { type: 'Point', coordinates: loc.geo },
    },
    deliveryRadiusKm: 25,
  });

  console.log(`[${index}/${total}] ✓ ${entry.title}  →  ${uploaded.url.slice(0, 70)}…`);
  return { ok: true };
}

/**
 * Delete products jinki image URL broken hai:
 *   - source.unsplash.com (Unsplash ne kill kar diya tha 2024 mein — har image 404)
 *   - images array empty hai
 *   - placeholder/example/test domains
 *
 * Note: Sirf seeded/demo products affect honge. Real seller products
 * (jinki Cloudinary URLs hain) safe rahenge.
 */
async function deleteBrokenExisting() {
  const brokenFilter = {
    $or: [
      { 'images.0.url': { $regex: 'source\\.unsplash\\.com', $options: 'i' } },
      { 'images.0.url': { $regex: 'placeholder', $options: 'i' } },
      { 'images.0.url': { $regex: 'via\\.placeholder', $options: 'i' } },
      { images: { $size: 0 } },
      { images: { $exists: false } },
      { 'images.0.url': '' },
    ],
  };

  const broken = await Product.find(brokenFilter)
    .select('_id title images')
    .lean();

  console.log(`[clean] Found ${broken.length} products with broken/missing images`);
  if (broken.length === 0) return;

  // Show first 5 as preview before destructive delete
  console.log('[clean] Sample being deleted:');
  broken.slice(0, 5).forEach((p) => {
    const u = p.images?.[0]?.url || '<no image>';
    console.log(`        - ${p.title}  |  ${u.slice(0, 60)}`);
  });

  const result = await Product.deleteMany({ _id: { $in: broken.map((b) => b._id) } });
  console.log(`[clean] ✓ deleted ${result.deletedCount} broken products`);
}

(async function main() {
  if (!SKIP_SEED && !PEXELS_KEY) {
    console.log('ℹ PEXELS_API_KEY not set — using picsum.photos (nice random images, no auth needed).');
    console.log('  For category-matched product images, sign up at pexels.com/api and add the key.');
  }
  // Cloudinary required for image upload regardless of source.
  if (!SKIP_SEED && !isConfigured) {
    console.error('❌ Cloudinary not configured. Set CLOUDINARY_* in .env');
    process.exit(1);
  }

  await connectDB();
  console.log('✓ MongoDB connected');

  if (DELETE_BROKEN) {
    await deleteBrokenExisting();
  }

  if (SKIP_SEED) {
    console.log('\n--skip-seed flag → not seeding new products, exiting.');
    await mongoose.disconnect();
    process.exit(0);
  }

  const sellers = await getOrCreateSeller();
  console.log(`✓ Using ${sellers.length} seller(s) for product attribution`);

  const list = LIMIT > 0 ? CATALOG.slice(0, LIMIT) : CATALOG;
  console.log(`\n→ Seeding ${list.length} products (catalog has ${CATALOG.length} total)\n`);

  let ok = 0;
  let skipped = 0;
  let failed = 0;
  for (let i = 0; i < list.length; i += 1) {
    try {
      const r = await seedOne(list[i], sellers, i + 1, list.length);
      if (r.ok) ok += 1;
      else if (r.skipped) skipped += 1;
      else if (r.failed) failed += 1;
    } catch (err) {
      failed += 1;
      console.log(`[${i + 1}/${list.length}] ✗ ${list[i].title} — ${err.message}`);
    }
  }

  console.log(`\n──────────────────────────────────────`);
  console.log(`  added:    ${ok}`);
  console.log(`  skipped:  ${skipped}  (already existed)`);
  console.log(`  failed:   ${failed}`);
  console.log(`──────────────────────────────────────`);

  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
