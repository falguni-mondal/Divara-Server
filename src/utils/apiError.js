export class ApiError extends Error {
  constructor(statusCode, message, details = null, code = "INTERNAL_ERROR") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message, details = null) {
    return new ApiError(400, message, details, "BAD_REQUEST");
  }

  static unauthorized(message = "Authentication required") {
    return new ApiError(401, message, null, "UNAUTHORIZED");
  }

  static forbidden(message = "You do not have permission to perform this action") {
    return new ApiError(403, message, null, "FORBIDDEN");
  }

  static notFound(message = "Resource not found") {
    return new ApiError(404, message, null, "NOT_FOUND");
  }

  static conflict(message, details = null) {
    return new ApiError(409, message, details, "CONFLICT");
  }
}