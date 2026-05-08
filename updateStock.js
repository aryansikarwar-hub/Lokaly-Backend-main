require('dotenv').config({ path: './.env' });
const mongoose = require('mongoose');
const Product = require('./src/models/Product');

async function updateAllStock() {
  try {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
    
    console.log('MONGO_URI:', process.env.MONGO_URI ? '✅ loaded' : '❌ missing');
    console.log('MONGODB_URI:', process.env.MONGODB_URI ? '✅ loaded' : '❌ missing');
    
    if (!uri) {
      console.error('❌ No MongoDB URI found in .env file');
      process.exit(1);
    }

    await mongoose.connect(uri);
    console.log('✅ Connected to MongoDB');

    const result = await Product.updateMany(
      { stock: { $lte: 0 } },
      { $set: { stock: 100 } }
    );

    console.log(`✅ Updated ${result.modifiedCount} products with stock = 100`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

updateAllStock();