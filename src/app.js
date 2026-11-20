import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import { env } from "./config/env.js";
import { configurePassport } from "./config/passport.js";
import { generalApiLimiter } from "./middlewares/rateLimit.middleware.js";
import { notFoundHandler, globalErrorHandler } from "./middlewares/error.middleware.js";
import { handleRazorpayWebhook } from "./controllers/checkout.controller.js";
import v1Routes from "./routes/v1/index.js";

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
      allowedHeaders: ["Content-Type", "Authorization"],
    })
  );

  // Raw JSON body preserved exclusively for Razorpay HMAC-SHA256 verification
  app.post(
    "/api/v1/webhooks/razorpay",
    express.raw({ type: "application/json", limit: "512kb" }),
    handleRazorpayWebhook
  );

  app.use(express.json({ limit: "256kb" }));
  app.use(cookieParser());

  const passport = configurePassport();
  app.use(passport.initialize());

  app.use("/api/v1", generalApiLimiter, v1Routes);

  app.use(notFoundHandler);
  app.use(globalErrorHandler);

  return app;
}