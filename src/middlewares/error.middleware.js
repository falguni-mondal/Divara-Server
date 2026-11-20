import { env } from "../config/env.js";
import { ApiError } from "../utils/apiError.js";

export function notFoundHandler(req, _res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

export function globalErrorHandler(err, _req, res, _next) {
  let statusCode = err.statusCode || 500;
  let code = err.code || "INTERNAL_ERROR";
  let message = err.message || "An unexpected server error occurred";
  let details = err.details || null;

  // Mongoose duplicate key error (E11000)
  if (err.code === 11000) {
    statusCode = 409;
    code = "DUPLICATE_RESOURCE";
    const field = Object.keys(err.keyPattern || {})[0] || "field";
    message = `A record with this ${field} already exists`;
  }

  // Mongoose invalid ObjectId cast error
  if (err.name === "CastError") {
    statusCode = 400;
    code = "INVALID_IDENTIFIER";
    message = `Invalid ${err.path || "identifier"} format`;
  }

  // Mongoose schema validation error
  if (err.name === "ValidationError") {
    statusCode = 400;
    code = "VALIDATION_ERROR";
    message = "Database validation failed";
    details = Object.fromEntries(
      Object.entries(err.errors || {}).map(([key, val]) => [key, [val.message]])
    );
  }

  if (statusCode >= 500) {
    console.error("[ServerError]", err);
  }

  return res.status(statusCode).json({
    success: false,
    error: {
      code,
      message: statusCode >= 500 && env.NODE_ENV === "production"
        ? "An unexpected server error occurred"
        : message,
      ...(details ? { details } : {}),
    },
  });
}