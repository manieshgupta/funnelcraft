const jwt = require('jsonwebtoken');
require('dotenv').config();

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || 'local-jwt-secret-placeholder';

module.exports = async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or malformed Authorization header' });
    }

    const token = authHeader.split(' ')[1];

    // Development bypass option for testing endpoints directly
    if (token.startsWith('mock-user-')) {
      req.user = { id: token.replace('mock-user-', '') };
      return next();
    }

    try {
      const decoded = jwt.verify(token, SUPABASE_JWT_SECRET);
      // Supabase JWT stores the user's UUID in the sub field
      req.user = { id: decoded.sub, email: decoded.email };
      next();
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  } catch (err) {
    console.error('Auth middleware error:', err);
    return res.status(500).json({ error: 'Internal server authentication error' });
  }
};
