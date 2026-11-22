import { getCookieOptions } from "../middlewares/auth.middleware.js";
import { sendSuccess } from "../utils/apiResponse.js";
import {
  DEVICE_COOKIE_NAME,
  DEVICE_COOKIE_MAX_AGE_MS,
  extractDeviceIdFromReq,
  extractSessionIdFromReq,
  identifyOrRecoverDevice,
  ingestActivityBatch,
  mergeVisitorToUser,
} from "../services/activity.service.js";

function parseBodySafely(body) {
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  return body && typeof body === "object" ? body : {};
}

export async function identifyDevice(req, res, next) {
  try {
    const body = parseBodySafely(req.body);
    const existingDeviceId =
      extractDeviceIdFromReq(req) ||
      (typeof body.storedDeviceId === "string" ? body.storedDeviceId.trim().slice(0, 64) : "");
    const sessionId =
      extractSessionIdFromReq(req) ||
      (typeof body.sessionId === "string" ? body.sessionId.trim().slice(0, 80) : "");

    const userId = req.user?._id || null;

    const { profile, matchType } = await identifyOrRecoverDevice({
      existingDeviceId,
      sessionId,
      rawSignals: body.signals || {},
      userId,
      deviceType: body.deviceType || "desktop",
      browserFamily: body.browserFamily || "Unknown",
    });

    // Set/refresh HttpOnly device cookie (primary persistence layer)
    res.cookie(
      DEVICE_COOKIE_NAME,
      profile.deviceId,
      getCookieOptions(DEVICE_COOKIE_MAX_AGE_MS)
    );

    // If user is already logged in on this device, merge any unclaimed visitor events
    if (userId) {
      await mergeVisitorToUser(profile.deviceId, userId);
    }

    return sendSuccess(res, {
      data: {
        deviceId: profile.deviceId,
        visitorCode: profile.visitorCode,
        matchType,
      },
    });
  } catch (err) {
    return next(err);
  }
}

export async function ingestBatch(req, res, next) {
  try {
    const body = parseBodySafely(req.body);
    const deviceId =
      extractDeviceIdFromReq(req) ||
      (typeof body.deviceId === "string" ? body.deviceId.trim().slice(0, 64) : "");
    const sessionId =
      extractSessionIdFromReq(req) ||
      (typeof body.sessionId === "string" ? body.sessionId.trim().slice(0, 80) : "");

    if (!deviceId) {
      return sendSuccess(res, { data: { accepted: 0, skipped: "missing_device_id" } });
    }

    const events = Array.isArray(body.events) ? body.events : [];
    const result = await ingestActivityBatch({
      deviceId,
      userId: req.user?._id || null,
      sessionId,
      events,
    });

    return sendSuccess(res, { data: result });
  } catch (err) {
    return next(err);
  }
}