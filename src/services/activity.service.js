import crypto from "crypto";
import { DeviceProfile } from "../models/DeviceProfile.js";
import { ActivityEvent } from "../models/ActivityEvent.js";

export const DEVICE_COOKIE_NAME = "divara_did";
export const DEVICE_COOKIE_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000; // 180 days

const ACTIVE_SESSION_COLLISION_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const DRIFT_MATCH_THRESHOLD = 0.8; // 80% weighted similarity
const NOISE_MARKERS = new Set(["", "unsupported", "blocked", "randomized", "unknown"]);

const SIGNAL_WEIGHTS = {
  webglRenderer: 24,
  webglVendor: 10,
  webglLimitsHash: 14,
  canvasHash: 12,
  audioHash: 10,
  webgpuHash: 8,
  mediaCodecsHash: 6,
  mathHash: 5,
  cpuCores: 4,
  deviceMemory: 3,
  maxTouchPoints: 2,
  osPlatform: 6,
  timezone: 4,
  primaryLanguage: 2,
};

function cleanStr(val, fallback = "unsupported", maxLen = 160) {
  if (typeof val !== "string") return fallback;
  const trimmed = val.trim();
  return trimmed ? trimmed.slice(0, maxLen) : fallback;
}

function cleanNum(val) {
  const n = Number(val);
  return Number.isFinite(n) && n >= 0 ? Math.min(256, Math.round(n)) : 0;
}

function sanitizeTier1Signals(raw = {}) {
  return {
    webglVendor: cleanStr(raw.webglVendor, "unsupported", 160),
    webglRenderer: cleanStr(raw.webglRenderer, "unsupported", 220),
    canvasHash: cleanStr(raw.canvasHash, "unsupported", 80),
    audioHash: cleanStr(raw.audioHash, "unsupported", 80),
    cpuCores: cleanNum(raw.cpuCores),
    deviceMemory: cleanNum(raw.deviceMemory),
    maxTouchPoints: cleanNum(raw.maxTouchPoints),
    osPlatform: cleanStr(raw.osPlatform, "unknown", 80),
    timezone: cleanStr(raw.timezone, "unknown", 80),
    primaryLanguage: cleanStr(raw.primaryLanguage, "unknown", 40),
    webglLimitsHash: cleanStr(raw.webglLimitsHash, "unsupported", 80),
    webgpuHash: cleanStr(raw.webgpuHash, "unsupported", 80),
    mediaCodecsHash: cleanStr(raw.mediaCodecsHash, "unsupported", 80),
    mathHash: cleanStr(raw.mathHash, "unsupported", 80),
  };
}

function computePrimaryHash(signals) {
  const canonical = {
    webglVendor: signals.webglVendor,
    webglRenderer: signals.webglRenderer,
    canvasHash: signals.canvasHash === "randomized" ? "randomized" : signals.canvasHash,
    audioHash: signals.audioHash === "randomized" ? "randomized" : signals.audioHash,
    cpuCores: signals.cpuCores,
    deviceMemory: signals.deviceMemory,
    maxTouchPoints: signals.maxTouchPoints,
    osPlatform: signals.osPlatform,
    timezone: signals.timezone,
    primaryLanguage: signals.primaryLanguage,
    webglLimitsHash: signals.webglLimitsHash,
    webgpuHash: signals.webgpuHash,
    mediaCodecsHash: signals.mediaCodecsHash,
    mathHash: signals.mathHash,
  };

  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex");
}

function detectHighCollisionHardware(signals) {
  const renderer = (signals.webglRenderer || "").toLowerCase();
  const platform = (signals.osPlatform || "").toLowerCase();
  return (
    renderer === "apple gpu" ||
    platform.includes("iphone") ||
    platform.includes("ipad")
  );
}

function computeWeightedSimilarity(incoming, stored) {
  let matchedWeight = 0;
  let totalWeight = 0;

  for (const [key, weight] of Object.entries(SIGNAL_WEIGHTS)) {
    const a = incoming[key];
    const b = stored?.[key];

    if (typeof a === "number" || typeof b === "number") {
      if (a === 0 && b === 0) continue;
      totalWeight += weight;
      if (a === b) matchedWeight += weight;
      continue;
    }

    const sa = String(a || "").trim();
    const sb = String(b || "").trim();
    if (NOISE_MARKERS.has(sa) && NOISE_MARKERS.has(sb)) continue;

    totalWeight += weight;
    if (sa === sb) matchedWeight += weight;
  }

  return totalWeight === 0 ? 0 : matchedWeight / totalWeight;
}

function generateVisitorCode(deviceId) {
  const short = crypto
    .createHash("sha256")
    .update(deviceId)
    .digest("hex")
    .slice(0, 6)
    .toUpperCase();
  return `VIS-${short}`;
}

export function extractDeviceIdFromReq(req) {
  const cookieId = req.cookies?.[DEVICE_COOKIE_NAME];
  if (typeof cookieId === "string" && cookieId.trim().length >= 12) {
    return cookieId.trim().slice(0, 64);
  }
  const headerId = req.headers?.["x-divara-device-id"];
  if (typeof headerId === "string" && headerId.trim().length >= 12) {
    return headerId.trim().slice(0, 64);
  }
  return "";
}

export function extractSessionIdFromReq(req) {
  const headerSid = req.headers?.["x-divara-session-id"];
  if (typeof headerSid === "string" && headerSid.trim()) {
    return headerSid.trim().slice(0, 80);
  }
  return "";
}

export async function identifyOrRecoverDevice({
  existingDeviceId = "",
  sessionId = "",
  rawSignals = {},
  userId = null,
  deviceType = "desktop",
  browserFamily = "Unknown",
}) {
  const signals = sanitizeTier1Signals(rawSignals);
  const primaryHash = computePrimaryHash(signals);
  const isHighCollisionHardware = detectHighCollisionHardware(signals);
  const now = new Date();

  const touchProfile = async (profile) => {
    const update = {
      $set: {
        primaryHash,
        signals,
        deviceType: ["mobile", "tablet", "desktop"].includes(deviceType)
          ? deviceType
          : profile.deviceType || "desktop",
        browserFamily: cleanStr(browserFamily, profile.browserFamily || "Unknown", 60),
        isHighCollisionHardware,
        lastActiveSessionId: sessionId || profile.lastActiveSessionId || "",
        lastSeenAt: now,
      },
      $addToSet: {
        knownHashes: primaryHash,
        ...(userId ? { linkedUserIds: userId } : {}),
      },
    };
    return DeviceProfile.findOneAndUpdate({ _id: profile._id }, update, {
      new: true,
    }).lean();
  };

  if (existingDeviceId) {
    const existing = await DeviceProfile.findOne({ deviceId: existingDeviceId }).lean();
    if (existing) {
      const updated = await touchProfile(existing);
      return { profile: updated, matchType: "stored" };
    }
  }

  const isCollisionBlocked = (candidate) => {
    if (!candidate.isHighCollisionHardware && !isHighCollisionHardware) return false;
    if (!sessionId || !candidate.lastActiveSessionId) return false;
    if (candidate.lastActiveSessionId === sessionId) return false;
    const msSinceSeen = now.getTime() - new Date(candidate.lastSeenAt || 0).getTime();
    return msSinceSeen < ACTIVE_SESSION_COLLISION_WINDOW_MS;
  };

  const exactCandidates = await DeviceProfile.find({
    $or: [{ primaryHash }, { knownHashes: primaryHash }],
  })
    .sort({ lastSeenAt: -1 })
    .limit(5)
    .lean();

  for (const candidate of exactCandidates) {
    if (!isCollisionBlocked(candidate)) {
      const updated = await touchProfile(candidate);
      return { profile: updated, matchType: "exact_hash" };
    }
  }

  const anchorQuery = {
    "signals.osPlatform": signals.osPlatform,
    "signals.timezone": signals.timezone,
  };
  if (!NOISE_MARKERS.has(signals.webglRenderer)) {
    anchorQuery["signals.webglRenderer"] = signals.webglRenderer;
  }

  const driftCandidates = await DeviceProfile.find(anchorQuery)
    .sort({ lastSeenAt: -1 })
    .limit(25)
    .lean();

  let bestCandidate = null;
  let bestScore = 0;

  for (const candidate of driftCandidates) {
    if (isCollisionBlocked(candidate)) continue;
    const score = computeWeightedSimilarity(signals, candidate.signals);
    if (score >= DRIFT_MATCH_THRESHOLD && score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  if (bestCandidate) {
    const updated = await touchProfile(bestCandidate);
    return { profile: updated, matchType: "drift_recovery", similarity: bestScore };
  }

  const newDeviceId = crypto.randomUUID();
  const created = await DeviceProfile.create({
    deviceId: newDeviceId,
    visitorCode: generateVisitorCode(newDeviceId),
    primaryHash,
    knownHashes: [primaryHash],
    signals,
    deviceType: ["mobile", "tablet", "desktop"].includes(deviceType)
      ? deviceType
      : "desktop",
    browserFamily: cleanStr(browserFamily, "Unknown", 60),
    isHighCollisionHardware,
    linkedUserIds: userId ? [userId] : [],
    lastActiveSessionId: sessionId || "",
    firstSeenAt: now,
    lastSeenAt: now,
  });

  return { profile: created.toObject(), matchType: "new" };
}

export async function mergeVisitorToUser(deviceId, userId) {
  if (!deviceId || !userId) return { mergedCount: 0 };

  const [mergeResult] = await Promise.all([
    ActivityEvent.updateMany(
      { deviceId, userId: null },
      { $set: { userId, mergedFromVisitor: true } }
    ),
    DeviceProfile.updateOne(
      { deviceId },
      {
        $addToSet: { linkedUserIds: userId },
        $set: { lastSeenAt: new Date() },
      }
    ),
  ]);

  return { mergedCount: mergeResult?.modifiedCount || 0 };
}

function sanitizeProductSnapshot(p) {
  if (!p || typeof p !== "object") return null;
  return {
    productId: p.productId || p._id || null,
    slug: cleanStr(p.slug, "", 180),
    title: cleanStr(p.title, "", 220),
    sku: cleanStr(p.sku, "", 80),
    primaryImage: cleanStr(p.primaryImage || p.image, "", 600),
    category: cleanStr(p.category, "", 80),
    fabric: cleanStr(p.fabric, "", 80),
    color: cleanStr(p.color, "", 80),
    size: cleanStr(p.size, "", 40),
    price: Number(p.price) || 0,
  };
}

function sanitizeCartItems(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 30).map((it) => ({
    productId: it.productId || it._id || null,
    slug: cleanStr(it.slug, "", 180),
    title: cleanStr(it.title, "", 220),
    sku: cleanStr(it.sku, "", 80),
    primaryImage: cleanStr(it.primaryImage || it.image, "", 600),
    size: cleanStr(it.size, "", 40),
    quantity: Math.max(1, Math.min(99, Number(it.quantity) || 1)),
    price: Number(it.price) || 0,
  }));
}

/**
 * Ingests a batched array of client events (max 25).
 * - PRODUCT_VIEW enriches the existing PAGE_VIEW doc for that pageViewId (no duplicates,
 *   and active dwell time attaches directly to the product for Interest Scoring).
 * - PAGE_DURATION atomically increments activeDurationSec on that PAGE_VIEW doc.
 */
export async function ingestActivityBatch({
  deviceId,
  userId = null,
  sessionId = "",
  events = [],
}) {
  if (!deviceId || !Array.isArray(events) || events.length === 0) {
    return { accepted: 0 };
  }

  const bounded = events.slice(0, 25);
  const docsToInsert = [];
  const productEnrichOps = [];
  const durationUpdates = [];

  for (const ev of bounded) {
    if (!ev || typeof ev !== "object") continue;

    if (ev.type === "PAGE_DURATION" && ev.pageViewId) {
      const delta = Math.max(0, Math.min(3600, Math.round(Number(ev.activeDeltaSec) || 0)));
      if (delta > 0) {
        durationUpdates.push({
          updateOne: {
            filter: {
              deviceId,
              pageViewId: cleanStr(ev.pageViewId, "", 80),
              type: "PAGE_VIEW",
            },
            update: {
              $inc: { activeDurationSec: delta },
            },
          },
        });
      }
      continue;
    }

    const occurredAt = ev.occurredAt ? new Date(ev.occurredAt) : new Date();
    const safeOccurredAt = Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt;

    // Enrich existing PAGE_VIEW with full product details instead of creating a duplicate row
    if (ev.type === "PAGE_VIEW" && ev.actionName === "PRODUCT_VIEW" && ev.pageViewId) {
      const pvId = cleanStr(ev.pageViewId, "", 80);
      const productSnap = sanitizeProductSnapshot(ev.product);
      const pageName = cleanStr(ev.pageName, "Product Detail", 140);
      const path = cleanStr(ev.path, "", 320);

      productEnrichOps.push({
        updateOne: {
          filter: { deviceId, pageViewId: pvId, type: "PAGE_VIEW" },
          update: {
            $set: {
              actionName: "PRODUCT_VIEW",
              pageName,
              path,
              product: productSnap,
              ...(userId ? { userId } : {}),
            },
            $setOnInsert: {
              deviceId,
              userId: userId || null,
              sessionId: cleanStr(ev.sessionId || sessionId, "", 80),
              type: "PAGE_VIEW",
              status: "INFO",
              pageViewId: pvId,
              activeDurationSec: 0,
              occurredAt: safeOccurredAt,
            },
          },
          upsert: true,
        },
      });
      continue;
    }

    const allowedTypes = new Set([
      "PAGE_VIEW",
      "ACTION",
      "CART_SNAPSHOT",
      "AUTH",
      "CHECKOUT",
    ]);
    if (!allowedTypes.has(ev.type)) continue;

    const allowedStatuses = new Set(["INFO", "SUCCESS", "FAILED", "WARNING"]);
    const status = allowedStatuses.has(ev.status) ? ev.status : "INFO";

    docsToInsert.push({
      deviceId,
      userId: userId || null,
      sessionId: cleanStr(ev.sessionId || sessionId, "", 80),
      type: ev.type,
      status,
      actionName: cleanStr(ev.actionName, "", 120),
      pageName: cleanStr(ev.pageName, "", 140),
      path: cleanStr(ev.path, "", 320),
      pageViewId: cleanStr(ev.pageViewId, "", 80),
      activeDurationSec: Math.max(0, Math.min(3600, Math.round(Number(ev.activeDurationSec) || 0))),
      product: sanitizeProductSnapshot(ev.product),
      cartItems: sanitizeCartItems(ev.cartItems),
      cartTotal: Math.max(0, Number(ev.cartTotal) || 0),
      meta: ev.meta && typeof ev.meta === "object" ? ev.meta : {},
      occurredAt: safeOccurredAt,
    });
  }

  // Insert base PAGE_VIEW docs first so enrich & duration ops in the same batch always match
  if (docsToInsert.length > 0) {
    await ActivityEvent.insertMany(docsToInsert, { ordered: false });
  }
  if (productEnrichOps.length > 0) {
    await ActivityEvent.bulkWrite(productEnrichOps, { ordered: false });
  }
  if (durationUpdates.length > 0) {
    await ActivityEvent.bulkWrite(durationUpdates, { ordered: false });
  }

  await DeviceProfile.updateOne(
    { deviceId },
    {
      $set: {
        lastSeenAt: new Date(),
        ...(sessionId ? { lastActiveSessionId: sessionId } : {}),
      },
      ...(userId ? { $addToSet: { linkedUserIds: userId } } : {}),
    }
  );

  return {
    accepted: docsToInsert.length + productEnrichOps.length + durationUpdates.length,
  };
}

export async function recordServerEvent({
  req,
  deviceId: explicitDeviceId = "",
  userId = null,
  type,
  status = "INFO",
  actionName = "",
  pageName = "",
  path = "",
  product = null,
  cartItems = [],
  cartTotal = 0,
  meta = {},
}) {
  try {
    const deviceId = explicitDeviceId || extractDeviceIdFromReq(req) || "server-direct";
    const sessionId = extractSessionIdFromReq(req);

    await ActivityEvent.create({
      deviceId,
      userId: userId || req?.user?._id || null,
      sessionId,
      type,
      status,
      actionName: cleanStr(actionName, "", 120),
      pageName: cleanStr(pageName, "", 140),
      path: cleanStr(path, "", 320),
      product: sanitizeProductSnapshot(product),
      cartItems: sanitizeCartItems(cartItems),
      cartTotal: Math.max(0, Number(cartTotal) || 0),
      meta: meta && typeof meta === "object" ? meta : {},
      occurredAt: new Date(),
    });
  } catch {
    // Telemetry must never break primary auth/bag/checkout flows
  }
}