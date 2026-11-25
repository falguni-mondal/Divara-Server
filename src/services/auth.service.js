import crypto from "crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { RefreshToken } from "../models/RefreshToken.js";
import { COOKIE_NAMES, getCookieOptions } from "../middlewares/auth.middleware.js";
import { ApiError } from "../utils/apiError.js";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function parseDurationMs(expr, fallbackMs = 15 * 60 * 1000) {
  const match = String(expr || "").trim().match(/^(\d+)([smhd])$/i);
  if (!match) return fallbackMs;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const mult = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
  return mult ? amount * mult : fallbackMs;
}

function signAccessToken(user) {
  return jwt.sign(
    {
      sub: String(user._id),
      role: user.role,
      email: user.email,
      tv: Number(user.tokenVersion || 0),
    },
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
  const accessTtlMs = parseDurationMs(env.JWT_ACCESS_EXPIRES_IN, 15 * 60 * 1000);
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

  res.cookie(COOKIE_NAMES.ACCESS, accessToken, getCookieOptions(accessTtlMs));
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
 * Atomically rotates an existing refresh token with expiry & replay-attack detection.
 * If an already-revoked token is reused, the entire token family is revoked immediately.
 */
export async function rotateRefreshToken(req, res) {
  const rawToken = req.cookies?.[COOKIE_NAMES.REFRESH];
  if (!rawToken) {
    throw ApiError.unauthorized("Refresh token missing");
  }

  const tokenHash = sha256(rawToken);
  const now = new Date();

  const claimed = await RefreshToken.findOneAndUpdate(
    { tokenHash, isRevoked: false, expiresAt: { $gt: now } },
    { $set: { isRevoked: true } },
    { returnDocument: "before" }
  ).populate("userId");

  if (!claimed) {
    // Check if this was a replay of an already-revoked token
    const existing = await RefreshToken.findOne({ tokenHash }).lean();
    if (existing?.isRevoked) {
      await RefreshToken.updateMany({ familyId: existing.familyId }, { $set: { isRevoked: true } });
      clearAuthCookies(res);
      throw ApiError.unauthorized("Session compromised. Please sign in again.");
    }
    clearAuthCookies(res);
    throw ApiError.unauthorized("Invalid or expired refresh session");
  }

  if (!claimed.userId || !claimed.userId.isActive) {
    clearAuthCookies(res);
    throw ApiError.unauthorized("Account is inactive");
  }

  return issueAuthSession(req, res, claimed.userId, claimed.familyId);
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