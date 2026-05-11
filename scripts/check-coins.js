const mongoose = require("mongoose");
const CoinLedger = require("../src/models/CoinLedger");

const MONGO_URI = "mongodb://localhost:27017/LokalyDB";

(async () => {
  await mongoose.connect(MONGO_URI);
  console.log("Connected to:", mongoose.connection.name, "\n");

  const rows = await CoinLedger.find({
    reason: { $in: ["referral_bonus", "referral_signup"] },
  })
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();

  if (rows.length === 0) {
    console.log("❌ No referral_bonus or referral_signup entries found.");
  } else {
    console.log(`✅ Found ${rows.length} entries:\n`);
    rows.forEach((r, i) => {
      console.log(`--- Entry ${i + 1} ---`);
      console.log("user:        ", r.user);
      console.log("delta:       ", r.delta);
      console.log("reason:      ", r.reason);
      console.log("balanceAfter:", r.balanceAfter);
      console.log("meta:        ", JSON.stringify(r.meta, null, 2));
      console.log("createdAt:   ", r.createdAt);
      console.log("");
    });
  }

  const counts = await CoinLedger.aggregate([
    { $group: { _id: "$reason", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  console.log("\n📊 All ledger entries by reason:");
  counts.forEach((c) =>
    console.log(`  ${String(c._id).padEnd(20)} ${c.count}`),
  );

  await mongoose.disconnect();
})();
