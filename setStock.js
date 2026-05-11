require("dotenv").config();
const mongoose = require("mongoose");
const Product = require("./src/models/Product");
const { connectDB } = require("./src/config/db");

(async () => {
  try {
    await connectDB();
    const result = await Product.updateMany({}, { $set: { stock: 100 } });
    console.log(`✅ Updated ${result.modifiedCount} products to stock=100`);
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error("❌ Failed:", err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
})();
