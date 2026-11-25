import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import { env } from "./config/env.js";
import { configurePassport } from "./config/passport.js";
import { COOKIE_NAMES } from "./middlewares/auth.middleware.js";
import { generalApiLimiter } from "./middlewares/rateLimit.middleware.js";
import { notFoundHandler, globalErrorHandler } from "./middlewares/error.middleware.js";
import { handleRazorpayWebhook } from "./controllers/checkout.controller.js";
import v1Routes from "./routes/v1/index.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function createOriginGuard() {
  const allowedOrigin = new URL(env.CLIENT_ORIGIN).origin;
  const isProd = env.NODE_ENV === "production";

  return function verifySameOrigin(req, res, next) {
    if (SAFE_METHODS.has(req.method)) return next();

    const originHeader = req.get("origin");
    if (originHeader) {
      if (originHeader === allowedOrigin) return next();
      return res.status(403).json({
        success: false,
        error: { code: "CSRF_ORIGIN_MISMATCH", message: "Cross-origin request blocked" },
      });
    }

    const refererHeader = req.get("referer");
    if (refererHeader) {
      try {
        if (new URL(refererHeader).origin === allowedOrigin) return next();
      } catch {}
      return res.status(403).json({
        success: false,
        error: { code: "CSRF_ORIGIN_MISMATCH", message: "Cross-origin request blocked" },
      });
    }

    // In production, block cookie-authenticated mutations that omit both Origin and Referer
    const hasAuthCookie = Boolean(
      req.cookies?.[COOKIE_NAMES.ACCESS] || req.cookies?.[COOKIE_NAMES.REFRESH]
    );
    if (isProd && hasAuthCookie) {
      return res.status(403).json({
        success: false,
        error: { code: "CSRF_ORIGIN_REQUIRED", message: "Origin header required" },
      });
    }

    return next();
  };
}

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);

  app.use(helmet());
  app.use(compression());
  app.use(
    cors({
      origin: env.CLIENT_ORIGIN,
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "X-Divara-Device-Id",
        "X-Divara-Session-Id",
      ],
    })
  );

  // Raw JSON body preserved exclusively for Razorpay HMAC-SHA256 verification (exempt from browser Origin check)
  app.post(
    "/api/v1/webhooks/razorpay",
    express.raw({ type: "application/json", limit: "512kb" }),
    handleRazorpayWebhook
  );

  app.use(express.json({ limit: "256kb" }));
  app.use(cookieParser());

  const passport = configurePassport();
  app.use(passport.initialize());

  app.use("/api/v1", generalApiLimiter, createOriginGuard(), v1Routes);

  app.use(notFoundHandler);
  app.use(globalErrorHandler);

  return app;
}