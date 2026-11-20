import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { User } from "../models/User.js";
import { ApiError } from "../utils/apiError.js";

export const COOKIE_NAMES = Object.freeze({
  ACCESS: "divara_at",
  REFRESH: "divara_rt",
});

export function getCookieOptions(maxAgeMs) {
  const isProd = env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    path: "/",
    ...(maxAgeMs ? { maxAge: maxAgeMs } : {}),
  };
}

export async function optionalAuth(req, _res, next) {
  try {
    const token = req.cookies?.[COOKIE_NAMES.ACCESS];
    if (!token) return next();

    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET);
    const user = await User.findById(payload.sub).select("-passwordHash").lean();

    if (user && user.isActive) {
      req.user = user;
    }
    return next();
  } catch {
    return next();
  }
}

export async function requireAuth(req, _res, next) {
  const token = req.cookies?.[COOKIE_NAMES.ACCESS];
  if (!token) {
    return next(ApiError.unauthorized("Please sign in to continue"));
  }

  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET);
    const user = await User.findById(payload.sub).select("-passwordHash").lean();

    if (!user || !user.isActive) {
      return next(ApiError.unauthorized("Account session is no longer active"));
    }

    req.user = user;
    return next();
  } catch {
    return next(ApiError.unauthorized("Session expired. Please refresh or sign in again."));
  }
}

export function requireAdmin(req, _res, next) {
  if (!req.user || req.user.role !== "admin") {
    return next(ApiError.forbidden("Admin privileges are required"));
  }
  return next();
}