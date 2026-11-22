import { ApiError } from "../utils/apiError.js";
import { sendSuccess } from "../utils/apiResponse.js";
import {
  listAnonymousVisitors,
  getProfileIntelligence,
} from "../services/intelligence.service.js";

export async function adminListVisitors(req, res, next) {
  try {
    const data = await listAnonymousVisitors({
      page: req.query.page,
      limit: req.query.limit,
      q: req.query.q,
    });
    return sendSuccess(res, { data });
  } catch (err) {
    return next(err);
  }
}

export async function adminGetProfileIntelligence(req, res, next) {
  try {
    const { type, id } = req.params;
    if (type !== "account" && type !== "visitor") {
      throw ApiError.badRequest("Profile type must be 'account' or 'visitor'");
    }

    const data = await getProfileIntelligence({
      type,
      id,
      eventType: req.query.eventType || "ALL",
      page: req.query.page,
      limit: req.query.limit,
    });

    if (!data) {
      throw ApiError.notFound("Profile not found");
    }

    return sendSuccess(res, { data });
  } catch (err) {
    return next(err);
  }
}