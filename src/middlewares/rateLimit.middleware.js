import rateLimit from "express-rate-limit";

const makeLimiter = ({ windowMs, max, message }) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      success: false,
      error: {
        code: "RATE_LIMITED",
        message,
      },
    },
  });

export const authRateLimiter = makeLimiter({
  windowMs: 60 * 1000,
  max: 12,
  message: "Too many authentication attempts. Please wait a minute and try again.",
});

export const searchRateLimiter = makeLimiter({
  windowMs: 60 * 1000,
  max: 60,
  message: "Too many search requests. Please slow down briefly.",
});

export const formRateLimiter = makeLimiter({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: "Too many form submissions. Please try again later.",
});

export const generalApiLimiter = makeLimiter({
  windowMs: 60 * 1000,
  max: 180,
  message: "Request rate limit exceeded. Please try again shortly.",
});