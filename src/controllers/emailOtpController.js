const crypto = require('crypto');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { sendOtpEmail } = require('../utils/mailer');

// ============= CONFIG =============
const OTP_TTL_MS         = 10 * 60 * 1000;  // 10 minutes
const RESEND_COOLDOWN_MS = 60 * 1000;       // 60 sec between sends
const MAX_SENDS_WINDOW   = 5;               // max 5 sends in 10-min window
const SEND_WINDOW_MS     = 10 * 60 * 1000;  // 10 min window
const MAX_ATTEMPTS       = 5;               // wrong tries before invalidation

// ============= HELPERS =============

// 6-digit cryptographically random OTP (no leading-zero strip — keep 6 chars)
function generateOtp() {
  // 0 .. 999999 inclusive
  const n = crypto.randomInt(0, 1_000_000);
  return n.toString().padStart(6, '0');
}

// User-specific salted hash so the same OTP for two users gives different hashes
function hashOtp(otp, userId) {
  return crypto.createHash('sha256')
    .update(`${otp}.${userId}`)
    .digest('hex');
}

// Constant-time comparison
function safeEqual(a, b) {
  const aBuf = Buffer.from(a || '', 'hex');
  const bBuf = Buffer.from(b || '', 'hex');
  if (aBuf.length !== bBuf.length || aBuf.length === 0) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

// ============= POST /api/auth/email/send-otp =============
exports.sendEmailOtp = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select(
    '+emailOtpHash +emailOtpExpiresAt +emailOtpAttempts +emailOtpSentAt +emailOtpSendCount +emailOtpWindowStartedAt'
  );
  if (!user) throw ApiError.notFound('User not found');
  if (user.isEmailVerified) {
    return res.json({ ok: true, alreadyVerified: true, message: 'Email already verified' });
  }
  if (!user.email) throw ApiError.badRequest('No email on account');

  const now = Date.now();

  // 1) 60-sec cooldown between sends
  if (user.emailOtpSentAt) {
    const sinceLast = now - user.emailOtpSentAt.getTime();
    if (sinceLast < RESEND_COOLDOWN_MS) {
      const wait = Math.ceil((RESEND_COOLDOWN_MS - sinceLast) / 1000);
      throw ApiError.tooManyRequests
        ? ApiError.tooManyRequests(`Please wait ${wait}s before requesting another code`)
        : new ApiError(429, `Please wait ${wait}s before requesting another code`);
    }
  }

  // 2) Sliding 10-min window cap (max 5 sends)
  const windowStart = user.emailOtpWindowStartedAt?.getTime() || 0;
  const windowOpen = now - windowStart < SEND_WINDOW_MS;
  if (windowOpen && (user.emailOtpSendCount || 0) >= MAX_SENDS_WINDOW) {
    throw new ApiError(429, 'Too many code requests. Try again in a few minutes.');
  }

  // 3) Generate + hash + persist
  const otp = generateOtp();
  user.emailOtpHash = hashOtp(otp, user._id.toString());
  user.emailOtpExpiresAt = new Date(now + OTP_TTL_MS);
  user.emailOtpAttempts = 0;
  user.emailOtpSentAt = new Date(now);

  if (windowOpen) {
    user.emailOtpSendCount = (user.emailOtpSendCount || 0) + 1;
  } else {
    user.emailOtpWindowStartedAt = new Date(now);
    user.emailOtpSendCount = 1;
  }

  await user.save();

  // 4) Send (fire-and-track)
  let mailMeta = {};
  try {
    mailMeta = await sendOtpEmail({ to: user.email, otp, name: user.name });
  } catch (err) {
    throw new ApiError(502, 'Could not send verification email. Try again.');
  }

  res.json({
    ok: true,
    message: 'Verification code sent',
    expiresInSec: Math.floor(OTP_TTL_MS / 1000),
    cooldownSec: Math.floor(RESEND_COOLDOWN_MS / 1000),
    // 🔧 In dev, expose OTP in response for easy testing (only when no SMTP)
    ...(mailMeta.dev && process.env.NODE_ENV !== 'production' ? { devOtp: otp } : {}),
  });
});

// ============= POST /api/auth/email/verify-otp =============
exports.verifyEmailOtp = asyncHandler(async (req, res) => {
  const { otp } = req.body || {};
  if (!otp) throw ApiError.badRequest('OTP is required');

  // Trim whitespace, accept "123 456" or "123-456" too
  const cleanOtp = String(otp).replace(/\D/g, '');
  if (!/^\d{6}$/.test(cleanOtp)) {
    throw ApiError.badRequest('OTP must be 6 digits');
  }

  const user = await User.findById(req.user._id).select(
    '+emailOtpHash +emailOtpExpiresAt +emailOtpAttempts'
  );
  if (!user) throw ApiError.notFound('User not found');
  if (user.isEmailVerified) {
    return res.json({ ok: true, alreadyVerified: true, user: user.toPublic() });
  }
  if (!user.emailOtpHash || !user.emailOtpExpiresAt) {
    throw ApiError.badRequest('No active code. Please request a new one.');
  }
  if (user.emailOtpExpiresAt.getTime() < Date.now()) {
    // Clear expired OTP
    user.emailOtpHash = null;
    user.emailOtpExpiresAt = null;
    user.emailOtpAttempts = 0;
    await user.save();
    throw ApiError.badRequest('Code expired. Please request a new one.');
  }
  if ((user.emailOtpAttempts || 0) >= MAX_ATTEMPTS) {
    user.emailOtpHash = null;
    user.emailOtpExpiresAt = null;
    user.emailOtpAttempts = 0;
    await user.save();
    throw ApiError.badRequest('Too many wrong attempts. Please request a new code.');
  }

  const candidate = hashOtp(cleanOtp, user._id.toString());
  const ok = safeEqual(candidate, user.emailOtpHash);

  if (!ok) {
    user.emailOtpAttempts = (user.emailOtpAttempts || 0) + 1;
    await user.save();
    const left = MAX_ATTEMPTS - user.emailOtpAttempts;
    throw ApiError.badRequest(
      left > 0
        ? `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left.`
        : 'Too many wrong attempts. Please request a new code.'
    );
  }

  // Success — verify & clear
  user.isEmailVerified = true;
  user.emailOtpHash = null;
  user.emailOtpExpiresAt = null;
  user.emailOtpAttempts = 0;
  user.emailOtpSentAt = null;
  user.emailOtpSendCount = 0;
  user.emailOtpWindowStartedAt = null;
  // Also clear legacy link-based token (so old link can't be reused)
  user.emailVerificationToken = null;
  user.emailVerificationExpiresAt = null;
  await user.save();

  // Optional: trust auto-promote (matches existing pattern in authController.verifyEmail)
  try {
    const { maybeAutoVerifySeller } = require('../services/trustService');
    await maybeAutoVerifySeller(user);
  } catch (_) { /* non-fatal */ }

  const publicUser = user.toPublic();
  publicUser.coins = user.coins || 0;
  publicUser.isEmailVerified = true;

  res.json({
    ok: true,
    message: 'Email verified successfully',
    user: publicUser,
  });
});

// ============= GET /api/auth/email/otp-status =============
// (Optional helper — UI can show "X seconds before resend allowed")
exports.getOtpStatus = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id)
    .select('+emailOtpExpiresAt +emailOtpSentAt');
  if (!user) throw ApiError.notFound('User not found');

  const now = Date.now();
  const cooldownLeft = user.emailOtpSentAt
    ? Math.max(0, Math.ceil((RESEND_COOLDOWN_MS - (now - user.emailOtpSentAt.getTime())) / 1000))
    : 0;
  const expiresInSec = user.emailOtpExpiresAt
    ? Math.max(0, Math.ceil((user.emailOtpExpiresAt.getTime() - now) / 1000))
    : 0;

  res.json({
    ok: true,
    isEmailVerified: !!user.isEmailVerified,
    hasActiveOtp: expiresInSec > 0,
    expiresInSec,
    cooldownLeftSec: cooldownLeft,
  });
});