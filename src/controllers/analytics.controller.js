import { TrafficVisit } from "../models/TrafficVisit.js";
import { sendSuccess } from "../utils/apiResponse.js";

function sanitizeUtm(value, fallback = "") {
  if (!value) return fallback;
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 100);
}

function detectDevice(ua = "") {
  const lower = String(ua).toLowerCase();
  if (/ipad|tablet|playbook|silk/.test(lower)) return "tablet";
  if (/mobile|iphone|android|ipod|blackberry|iemobile|opera mini/.test(lower)) return "mobile";
  return "desktop";
}

export async function trackVisit(req, res) {
  const {
    sessionId,
    landingPath = "/",
    utmSource,
    utmMedium,
    utmCampaign,
    utmContent,
    referralPerson,
    referrerHost = "",
  } = req.body;

  let cleanReferrer = "";
  if (referrerHost) {
    try {
      cleanReferrer = referrerHost.includes("://")
        ? new URL(referrerHost).hostname.toLowerCase()
        : String(referrerHost).toLowerCase().trim().slice(0, 160);
    } catch {
      cleanReferrer = "";
    }
  }

  const normalizedSource =
    sanitizeUtm(utmSource) || (cleanReferrer ? cleanReferrer.replace(/^www\./, "") : "direct");
  const normalizedMedium =
    sanitizeUtm(utmMedium) || (cleanReferrer ? "referral" : "none");

  await TrafficVisit.create({
    sessionId: String(sessionId).slice(0, 80),
    landingPath: String(landingPath || "/").slice(0, 300),
    utmSource: normalizedSource,
    utmMedium: normalizedMedium,
    utmCampaign: sanitizeUtm(utmCampaign),
    utmContent: sanitizeUtm(utmContent),
    referralPerson: sanitizeUtm(referralPerson),
    referrerHost: cleanReferrer,
    deviceType: detectDevice(req.get("user-agent")),
  });

  return sendSuccess(res, { statusCode: 201, data: { tracked: true } });
}