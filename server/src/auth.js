import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { config } from './config.js';

/**
 * Verify API Key (for agent authentication)
 */
export function verifyAPIKey(key) {
  return key === config.API_KEY;
}

/**
 * Hash password with bcrypt
 */
export async function hashPassword(password) {
  return await bcrypt.hash(password, 12);
}

/**
 * Verify password against hash
 */
export async function verifyPassword(password, hash) {
  return await bcrypt.compare(password, hash);
}

/**
 * Generate JWT access token
 */
export function generateAccessToken(payload) {
  return jwt.sign(payload, config.JWT_SECRET, {
    expiresIn: config.JWT_ACCESS_EXPIRY
  });
}

/**
 * Generate JWT refresh token
 */
export function generateRefreshToken(payload) {
  return jwt.sign(payload, config.JWT_SECRET, {
    expiresIn: config.JWT_REFRESH_EXPIRY
  });
}

/**
 * Verify JWT token
 */
export function verifyToken(token) {
  try {
    return jwt.verify(token, config.JWT_SECRET);
  } catch (error) {
    return null;
  }
}

/**
 * Middleware to verify JWT access token from cookie or Authorization header
 */
export function requireAuth(req, res, next) {
  // Try cookie first (for web UI)
  let token = req.cookies?.access_token;

  // Fall back to Authorization header (for API clients)
  if (!token && req.headers?.authorization) {
    const authHeader = req.headers.authorization;
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }
  }

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  const decoded = verifyToken(token);

  if (!decoded) {
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }

  req.user = decoded;
  next();
}

/**
 * Middleware to verify API Key from Authorization header (WebSocket upgrade)
 */
export function requireAPIKey(req, res, next) {
  const authHeader = req.headers?.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing API key' });
  }

  const key = authHeader.substring(7); // Remove 'Bearer ' prefix

  if (!verifyAPIKey(key)) {
    return res.status(401).json({ error: 'Unauthorized: Invalid API key' });
  }

  req.agent = true;
  next();
}

/**
 * Verify admin password
 */
export async function verifyAdminPassword(password) {
  return await verifyPassword(password, config.ADMIN_PASSWORD_HASH);
}
