require("dotenv").config();
const mongoose = require("mongoose");
const { connectDB } = require("../src/config/db");
const User = require("../src/models/User");
const Product = require("../src/models/Product");

(async () => {
  await connectDB();

  const sellers = await User.find({
    role: "seller",
    "location.geo.coordinates": { $exists: true, $ne: [0, 0] },
  })
    .select("_id location")
    .lean();

  // eslint-disable-next-line no-console
  console.log(`Found ${sellers.length} sellers with valid location.`);

  let total = 0;
  for (const s of sellers) {
    const result = await Product.syncSellerLocation(s._id, s.location);
    total += result.modified;
    // eslint-disable-next-line no-console
    console.log(`  seller ${s._id} → ${result.modified} products synced`);
  }

  // eslint-disable-next-line no-console
  console.log(`\nDone. ${total} products updated.`);
  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
