import crypto from "crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { RefreshToken } from "../models/RefreshToken.js";
import { COOKIE_NAMES, getCookieOptions } from "../middlewares/auth.middleware.js";
import { ApiError } from "../utils/apiError.js";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function signAccessToken(user) {
  return jwt.sign(
    { sub: String(user._id), role: user.role, email: user.email },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.JWT_ACCESS_EXPIRES_IN }
  );
}

/**
 * Issues fresh HttpOnly Access + Refresh cookies and persists the refresh token hash
 * in MongoDB with a native TTL index (zero Redis).
 */
export async function issueAuthSession(req, res, user, existingFamilyId = null) {
  const accessToken = signAccessToken(user);
  const rawRefreshToken = crypto.randomBytes(48).toString("hex");
  const familyId = existingFamilyId || crypto.randomUUID();
  const refreshTtlMs = env.JWT_REFRESH_EXPIRES_DAYS * 24 * 60 * 60 * 1000;
  const expiresAt = new Date(Date.now() + refreshTtlMs);

  await RefreshToken.create({
    userId: user._id,
    tokenHash: sha256(rawRefreshToken),
    familyId,
    userAgent: req.get("user-agent") || "",
    ipAddress: req.ip || "",
    expiresAt,
  });

  res.cookie(COOKIE_NAMES.ACCESS, accessToken, getCookieOptions(15 * 60 * 1000));
  res.cookie(COOKIE_NAMES.REFRESH, rawRefreshToken, getCookieOptions(refreshTtlMs));

  return {
    id: String(user._id),
    email: user.email,
    fullName: user.fullName,
    avatarUrl: user.avatarUrl,
    role: user.role,
  };
}

/**
 * Rotates an existing refresh token with replay-attack detection.
 * If a revoked token is reused, the entire token family is revoked immediately.
 */
export async function rotateRefreshToken(req, res) {
  const rawToken = req.cookies?.[COOKIE_NAMES.REFRESH];
  if (!rawToken) {
    throw ApiError.unauthorized("Refresh token missing");
  }

  const tokenHash = sha256(rawToken);
  const stored = await RefreshToken.findOne({ tokenHash }).populate("userId");

  if (!stored || !stored.userId || !stored.userId.isActive) {
    clearAuthCookies(res);
    throw ApiError.unauthorized("Invalid refresh session");
  }

  if (stored.isRevoked) {
    // Replay detected: revoke the entire family
    await RefreshToken.updateMany({ familyId: stored.familyId }, { $set: { isRevoked: true } });
    clearAuthCookies(res);
    throw ApiError.unauthorized("Session compromised. Please sign in again.");
  }

  stored.isRevoked = true;
  await stored.save();

  return issueAuthSession(req, res, stored.userId, stored.familyId);
}

export async function revokeCurrentSession(req, res) {
  const rawToken = req.cookies?.[COOKIE_NAMES.REFRESH];
  if (rawToken) {
    await RefreshToken.updateOne(
      { tokenHash: sha256(rawToken) },
      { $set: { isRevoked: true } }
    );
  }
  clearAuthCookies(res);
}

export function clearAuthCookies(res) {
  const opts = getCookieOptions();
  res.clearCookie(COOKIE_NAMES.ACCESS, opts);
  res.clearCookie(COOKIE_NAMES.REFRESH, opts);
}