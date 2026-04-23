// One-off migration: mark all existing users as emailVerified=true so they
// can keep logging in without re-verifying after task 3 rolls out.
//
// Usage: `node scripts/backfillEmailVerified.js`
//
// Safe to re-run — updateMany is idempotent. Clears any lingering verify
// tokens so stale links stop working.

require('dotenv').config();
const mongoose = require('mongoose');
const env = require('../src/config/env');
const User = require('../src/models/User');

(async () => {
  try {
    await mongoose.connect(env.mongoUri);
    const res = await User.updateMany(
      {},
      {
        $set: {
          isEmailVerified: true,
          emailVerificationToken: null,
          emailVerificationExpiresAt: null,
        },
      }
    );
    // eslint-disable-next-line no-console
    console.log('[backfillEmailVerified] matched=%d modified=%d', res.matchedCount, res.modifiedCount);
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[backfillEmailVerified] failed:', err);
    process.exit(1);
  }
})();
