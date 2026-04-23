const jwt = require('jsonwebtoken');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const env = require('../config/env');

async function requireAuth(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return next(ApiError.unauthorized('Missing token'));

    const payload = jwt.verify(token, env.jwt.secret);
    const user = await User.findById(payload.sub);
    if (!user || !user.isActive) return next(ApiError.unauthorized('User not found'));

    req.user = user;
    req.auth = payload;
    next();
  } catch (err) {
    next(err);
  }
}

function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) return next(ApiError.forbidden('Insufficient role'));
    next();
  };
}

function requireAdmin(req, _res, next) {
  if (!req.user) return next(ApiError.unauthorized());
  if (req.user.role !== 'admin') return next(ApiError.forbidden('Admin only'));
  next();
}

module.exports = { requireAuth, requireRole, requireAdmin };
