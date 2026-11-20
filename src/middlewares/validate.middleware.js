import { ApiError } from "../utils/apiError.js";

/**
 * Validates req.body, req.query, or req.params using a Zod schema
 * and stores parsed values cleanly on req.validated.
 */
export function validate(schema, target = "body") {
  return (req, _res, next) => {
    const result = schema.safeParse(req[target]);
    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      return next(ApiError.badRequest("Validation failed", fieldErrors));
    }

    req.validated = {
      ...(req.validated || {}),
      [target]: result.data,
    };

    if (target === "body") {
      req.body = result.data;
    }

    return next();
  };
}