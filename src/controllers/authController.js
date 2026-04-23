const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const env = require('../config/env');

function generateVerifyToken() {
  return crypto.randomBytes(32).toString('hex');
}

function buildVerifyUrl(token) {
  const base = process.env.BASE_URL || env.clientUrl || 'http://localhost:5173';
  return `${base}/verify-email?token=${token}`;
}

async function sendVerifyEmail(email, url) {
  // Always log so dev flows continue to work without SMTP.
  // eslint-disable-next-line no-console
  console.log('VERIFY_URL:', url);
  if (!process.env.SMTP_HOST) return;
  try {
    // nodemailer is optional — require lazily to avoid boot failure if not installed.
    // eslint-disable-next-line global-require, import/no-unresolved, node/no-missing-require
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'no-reply@lokaly.local',
      to: email,
      subject: 'Verify your Lokaly email',
      text: `Click to verify: ${url}`,
      html: `<p>Click to verify your Lokaly account: <a href="${url}">${url}</a></p>`,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[auth] nodemailer send failed:', err.message);
  }
}

function signToken(user) {
  return jwt.sign({ sub: user._id.toString(), role: user.role }, env.jwt.secret, {
    expiresIn: env.jwt.expiresIn,
  });
}

// Ensures /auth responses always include `coins` and `isEmailVerified`
// even if the Mongoose toObject pipeline drops them.
function publicUser(user) {
  const obj = user.toPublic();
  obj.coins = user.coins || 0;
  obj.isEmailVerified = !!user.isEmailVerified;
  return obj;
}

exports.signup = asyncHandler(async (req, res) => {
  const { name, email, password, role, shopName, shopCategory, referralCode } = req.body || {};
  if (!name || !email || !password) throw ApiError.badRequest('name, email, password required');
  if (password.length < 6) throw ApiError.badRequest('password must be >= 6 chars');

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) throw ApiError.conflict('Email already registered');

  let referredBy = null;
  if (referralCode) {
    const inviter = await User.findOne({ referralCode: referralCode.toUpperCase() });
    if (inviter) referredBy = inviter._id;
  }

  const verifyToken = generateVerifyToken();
  const user = await User.create({
    name,
    email: email.toLowerCase(),
    passwordHash: password,
    role: ['buyer', 'seller'].includes(role) ? role : 'buyer',
    shopName: role === 'seller' ? shopName : undefined,
    shopCategory: role === 'seller' ? shopCategory : undefined,
    referredBy,
    isEmailVerified: false,
    emailVerificationToken: verifyToken,
    emailVerificationExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });

  await sendVerifyEmail(user.email, buildVerifyUrl(verifyToken));

  // If a seller signs up with a referral code, create the referral tracking row.
  if (referredBy && user.role === 'seller') {
    try {
      const { registerReferral } = require('../services/referralService');
      await registerReferral({ referrerId: referredBy, referredSellerId: user._id });
    } catch (_) { /* non-fatal */ }
  }

  const token = signToken(user);
  res.status(201).json({ token, user: publicUser(user) });
});

exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) throw ApiError.badRequest('email and password required');

  const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');
  if (!user || !user.isActive) throw ApiError.unauthorized('Invalid credentials');

  const ok = await user.verifyPassword(password);
  if (!ok) throw ApiError.unauthorized('Invalid credentials');

  user.lastSeenAt = new Date();
  await user.save();

  const token = signToken(user);
  res.json({ token, user: publicUser(user) });
});

exports.me = asyncHandler(async (req, res) => {
  res.json({ user: publicUser(req.user) });
});

exports.logout = asyncHandler(async (_req, res) => {
  // JWT is stateless — client drops the token. Hook here for future revocation list.
  res.json({ ok: true });
});

exports.updateProfile = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const updatable = ['name', 'bio', 'avatar', 'phone', 'language', 'shopName', 'shopCategory'];
  for (const key of updatable) if (key in body) req.user[key] = body[key];

  // `address` and `location` both write into user.location. `address` is the
  // frontend "Edit Profile" shape ({ street, city, state, pincode, country }).
  if (body.address && typeof body.address === 'object') {
    const addr = body.address;
    const loc = req.user.location || {};
    if ('street' in addr) loc.street = addr.street;
    if ('city' in addr) loc.city = addr.city;
    if ('state' in addr) loc.state = addr.state;
    if ('pincode' in addr) loc.pincode = addr.pincode;
    if ('country' in addr) loc.country = addr.country;
    req.user.location = loc;
  }
  if (body.location && typeof body.location === 'object') {
    const loc = req.user.location || {};
    for (const k of ['street', 'city', 'state', 'pincode', 'country', 'geo']) {
      if (k in body.location) loc[k] = body.location[k];
    }
    req.user.location = loc;
  }

  await req.user.save();
  res.json({ user: publicUser(req.user) });
});

exports.verifyEmail = asyncHandler(async (req, res) => {
  const { token } = req.body || {};
  if (!token) throw ApiError.badRequest('token required');

  const user = await User.findOne({ emailVerificationToken: token })
    .select('+emailVerificationToken +emailVerificationExpiresAt');
  if (!user) throw ApiError.badRequest('Invalid or expired token');
  if (user.emailVerificationExpiresAt && user.emailVerificationExpiresAt.getTime() < Date.now()) {
    throw ApiError.badRequest('Token expired');
  }

  user.isEmailVerified = true;
  user.emailVerificationToken = null;
  user.emailVerificationExpiresAt = null;
  await user.save();

  // Attempt auto-promote to verified seller if trust threshold met.
  try {
    const { maybeAutoVerifySeller } = require('../services/trustService');
    await maybeAutoVerifySeller(user);
  } catch (_) { /* non-fatal */ }

  res.json({ ok: true, user: publicUser(user) });
});

exports.resendVerification = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id)
    .select('+emailVerificationToken +emailVerificationExpiresAt');
  if (!user) throw ApiError.notFound();
  if (user.isEmailVerified) return res.json({ ok: true, alreadyVerified: true });

  user.emailVerificationToken = generateVerifyToken();
  user.emailVerificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await user.save();

  await sendVerifyEmail(user.email, buildVerifyUrl(user.emailVerificationToken));

  res.json({ ok: true });
});
