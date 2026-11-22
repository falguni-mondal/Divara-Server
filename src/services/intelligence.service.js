import mongoose from "mongoose";
import { DeviceProfile } from "../models/DeviceProfile.js";
import { ActivityEvent } from "../models/ActivityEvent.js";
import { User } from "../models/User.js";
import { Order } from "../models/Order.js";
import { Bag } from "../models/Bag.js";
import { Product } from "../models/Product.js";

const HALF_LIFE_DAYS = 14;
const LN2 = Math.LN2;
const PAID_ORDER_STATUSES = new Set([
  "PAID",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
  "RETURN_REJECTED",
]);

function decayFactor(date) {
  const ageDays = Math.max(0, (Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
  return Math.exp((-LN2 * ageDays) / HALF_LIFE_DAYS);
}

export function formatIstDateTime(dateInput) {
  if (!dateInput) return { date: "—", time: "—" };
  const d = new Date(dateInput);
  if (Number.isNaN(d.getTime())) return { date: "—", time: "—" };

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).formatToParts(d);

  const get = (t) => parts.find((p) => p.type === t)?.value || "";
  const date = `${get("day")}/${get("month")}/${get("year")}`;
  const period = (get("dayPeriod") || "").toUpperCase();
  const time = `${get("hour")}:${get("minute")}:${get("second")} ${period}`.trim();
  return { date, time };
}

function addScore(map, key, amount) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + amount);
}

function topEntries(map, limit = 4) {
  const total = Array.from(map.values()).reduce((s, v) => s + v, 0);
  if (total <= 0) return [];
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, weight]) => ({
      name,
      sharePct: Math.round((weight / total) * 100),
    }));
}

async function computeProfileAnalytics(events, { liveCartItems = [], paidOrders = [] } = {}) {
  const productMap = new Map();
  const categoryWeights = new Map();
  const fabricWeights = new Map();
  const colorWeights = new Map();
  const sizeWeights = new Map();
  const observedPrices = [];

  const purchasedSlugs = new Set();
  for (const ord of paidOrders) {
    for (const it of ord.items || []) {
      if (it.slug) purchasedSlugs.add(it.slug);
    }
  }

  let totalActiveSeconds = 0;
  let totalPageViews = 0;
  let totalActions = 0;
  let checkoutFailedCount = 0;
  let checkoutStartedCount = 0;
  let authFailedCount = 0;

  const ensureProd = (p) => {
    const key = p.slug || String(p.productId || "");
    if (!key) return null;
    if (!productMap.has(key)) {
      productMap.set(key, {
        productId: p.productId || null,
        slug: p.slug || "",
        title: p.title || p.slug || "Garment",
        sku: p.sku || "",
        primaryImage: p.primaryImage || "",
        category: p.category || "",
        fabric: p.fabric || "",
        color: p.color || "",
        price: Number(p.price) || 0,
        visits: 0,
        activeSeconds: 0,
        cartAdds: 0,
        microActions: 0,
        inLiveCart: false,
        longCartDwell: false,
        checkoutDropOff: false,
        rawScore: 0,
        lastTouchedAt: null,
      });
    }
    const entry = productMap.get(key);
    if (p.title && !entry.title) entry.title = p.title;
    if (p.sku && !entry.sku) entry.sku = p.sku;
    if (p.primaryImage && !entry.primaryImage) entry.primaryImage = p.primaryImage;
    if (p.price && !entry.price) entry.price = Number(p.price);
    return entry;
  };

  for (const ev of events) {
    const decay = decayFactor(ev.occurredAt || ev.createdAt);

    if (ev.type === "PAGE_VIEW") {
      totalPageViews += 1;
      totalActiveSeconds += Number(ev.activeDurationSec) || 0;
    } else if (ev.type === "ACTION") {
      totalActions += 1;
    } else if (ev.type === "AUTH" && ev.status === "FAILED") {
      authFailedCount += 1;
    } else if (ev.type === "CHECKOUT") {
      if (ev.actionName === "CHECKOUT_STARTED") checkoutStartedCount += 1;
      if (ev.status === "FAILED" || ev.actionName === "CHECKOUT_PAYMENT_FAILED") {
        checkoutFailedCount += 1;
      }
    }

    if (ev.product && (ev.product.slug || ev.product.productId)) {
      const entry = ensureProd(ev.product);
      if (entry) {
        const ts = ev.occurredAt || ev.createdAt;
        if (!entry.lastTouchedAt || new Date(ts) > new Date(entry.lastTouchedAt)) {
          entry.lastTouchedAt = ts;
        }
        if (entry.price > 0) observedPrices.push(entry.price);

        let points = 0;
        if (ev.type === "PAGE_VIEW") {
          entry.visits += 1;
          const dwell = Number(ev.activeDurationSec) || 0;
          entry.activeSeconds += dwell;
          points += Math.min(15, 5) + Math.min(25, Math.floor(dwell / 10));
        } else if (ev.actionName === "ADD_TO_BAG" || ev.actionName === "PDP_ADD_TO_BAG") {
          entry.cartAdds += 1;
          points += entry.cartAdds > 1 ? 35 : 25;
        } else if (ev.actionName === "PDP_SIZE_GUIDE_UNIT") {
          entry.microActions += 1;
          points += 8;
        } else if (ev.actionName === "PDP_SIZE_SELECT") {
          entry.microActions += 1;
          points += 6;
          if (ev.product.size) addScore(sizeWeights, ev.product.size, 6 * decay);
        } else if (ev.actionName === "WISHLIST_ADD") {
          entry.microActions += 1;
          points += 12;
        } else if (ev.actionName?.startsWith("PDP_")) {
          entry.microActions += 1;
          points += 4;
        }

        const weighted = points * decay;
        entry.rawScore += weighted;
        addScore(categoryWeights, ev.product.category, weighted);
        addScore(fabricWeights, ev.product.fabric, weighted);
        addScore(colorWeights, ev.product.color, weighted);
      }
    }

    // Score checkout drop-off items
    if (
      ev.type === "CHECKOUT" &&
      (ev.status === "FAILED" || ev.actionName === "CHECKOUT_ABANDONED_HOLD_RELEASED") &&
      Array.isArray(ev.cartItems)
    ) {
      for (const ci of ev.cartItems) {
        const entry = ensureProd(ci);
        if (entry) {
          entry.checkoutDropOff = true;
          entry.rawScore += 30 * decay;
        }
      }
    }
  }

  // Factor in live cart items & long cart dwell (> 24h)
  const nowMs = Date.now();
  let hasLongCartDwell = false;
  for (const ci of liveCartItems) {
    const entry = ensureProd(ci);
    if (entry) {
      entry.inLiveCart = true;
      const addedMs = ci.addedAt ? new Date(ci.addedAt).getTime() : 0;
      if (addedMs && nowMs - addedMs >= 24 * 60 * 60 * 1000) {
        entry.longCartDwell = true;
        entry.rawScore += 20;
        hasLongCartDwell = true;
      } else {
        entry.rawScore += 12;
      }
    }
  }

  const topInterestedProducts = Array.from(productMap.values())
    .map((item) => {
      const alreadyBought = purchasedSlugs.has(item.slug);
      const adjusted = alreadyBought ? item.rawScore * 0.45 : item.rawScore;
      const interestScore = Math.min(100, Math.round(adjusted));
      return {
        ...item,
        alreadyBought,
        interestScore,
      };
    })
    .filter((i) => i.interestScore > 0)
    .sort((a, b) => b.interestScore - a.interestScore)
    .slice(0, 8);

  // Determine Buyer Intent Stage
  let intentStage = "Window Shopper";
  if (checkoutFailedCount > 0 || (checkoutStartedCount > 0 && paidOrders.length === 0)) {
    intentStage = "Checkout Drop-Off";
  } else if (liveCartItems.length > 0 || hasLongCartDwell) {
    intentStage = "High-Intent Cart Holder";
  } else if (paidOrders.length >= 2) {
    intentStage = "Repeat VIP";
  } else if (topInterestedProducts.some((p) => p.interestScore >= 25) || totalActiveSeconds >= 120) {
    intentStage = "Warm Explorer";
  }

  // Build Smart Actionable Alerts
  const alerts = [];
  if (checkoutFailedCount > 0) {
    alerts.push(
      `Payment failed ${checkoutFailedCount} time${checkoutFailedCount > 1 ? "s" : ""} — high-priority recovery lead.`
    );
  }
  const longDwellProd = topInterestedProducts.find((p) => p.longCartDwell);
  if (longDwellProd) {
    alerts.push(
      `Kept "${longDwellProd.title}" in bag for over 24 hours without completing checkout.`
    );
  }
  const topProd = topInterestedProducts[0];
  if (topProd && topProd.activeSeconds >= 60) {
    const mins = Math.floor(topProd.activeSeconds / 60);
    const secs = topProd.activeSeconds % 60;
    alerts.push(
      `Spent ${mins > 0 ? `${mins}m ` : ""}${secs}s actively viewing "${topProd.title}" (${topProd.visits} visit${topProd.visits === 1 ? "" : "s"}).`
    );
  }
  if (authFailedCount >= 3) {
    alerts.push(`${authFailedCount} failed login/OTP attempts recorded on this profile.`);
  }

  const priceBand =
    observedPrices.length > 0
      ? {
          min: Math.min(...observedPrices),
          max: Math.max(...observedPrices),
          avg: Math.round(
            observedPrices.reduce((s, v) => s + v, 0) / observedPrices.length
          ),
        }
      : null;

  return {
    intentStage,
    alerts,
    summary: {
      totalActiveSeconds,
      totalPageViews,
      totalActions,
      checkoutStartedCount,
      checkoutFailedCount,
      authFailedCount,
    },
    topInterestedProducts,
    styleDna: {
      categories: topEntries(categoryWeights, 4),
      fabrics: topEntries(fabricWeights, 4),
      colors: topEntries(colorWeights, 4),
      sizes: topEntries(sizeWeights, 3),
      priceBand,
    },
  };
}

/**
 * Lists anonymous visitor devices that have unclaimed visitor activity
 * (or all known devices with visitor summaries) for the Admin Users -> Visitors tab.
 */
export async function listAnonymousVisitors({ page = 1, limit = 15, q = "" } = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 15));

  const filter = {};
  if (q && q.trim()) {
    const regex = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [
      { visitorCode: regex },
      { deviceId: regex },
      { browserFamily: regex },
      { "signals.osPlatform": regex },
    ];
  }

  const [profiles, total] = await Promise.all([
    DeviceProfile.find(filter)
      .sort({ lastSeenAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .lean(),
    DeviceProfile.countDocuments(filter),
  ]);

  const deviceIds = profiles.map((p) => p.deviceId);
  const aggStats =
    deviceIds.length > 0
      ? await ActivityEvent.aggregate([
          { $match: { deviceId: { $in: deviceIds }, userId: null } },
          {
            $group: {
              _id: "$deviceId",
              eventCount: { $sum: 1 },
              pageViews: {
                $sum: { $cond: [{ $eq: ["$type", "PAGE_VIEW"] }, 1, 0] },
              },
              totalActiveSeconds: { $sum: "$activeDurationSec" },
              lastEventAt: { $max: "$occurredAt" },
            },
          },
        ])
      : [];

  const statsMap = new Map(aggStats.map((s) => [s._id, s]));

  const visitors = profiles.map((p) => {
    const st = statsMap.get(p.deviceId) || {
      eventCount: 0,
      pageViews: 0,
      totalActiveSeconds: 0,
      lastEventAt: p.lastSeenAt,
    };
    const formatted = formatIstDateTime(st.lastEventAt || p.lastSeenAt);
    return {
      deviceId: p.deviceId,
      visitorCode: p.visitorCode,
      deviceType: p.deviceType,
      browserFamily: p.browserFamily,
      osPlatform: p.signals?.osPlatform || "Unknown",
      isHighCollisionHardware: Boolean(p.isHighCollisionHardware),
      linkedAccountsCount: Array.isArray(p.linkedUserIds) ? p.linkedUserIds.length : 0,
      isSharedDevice: Array.isArray(p.linkedUserIds) && p.linkedUserIds.length > 1,
      eventCount: st.eventCount,
      pageViews: st.pageViews,
      totalActiveSeconds: st.totalActiveSeconds,
      lastSeenDate: formatted.date,
      lastSeenTime: formatted.time,
      lastSeenAt: st.lastEventAt || p.lastSeenAt,
    };
  });

  return {
    visitors,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.max(1, Math.ceil(total / safeLimit)),
    },
  };
}

/**
 * Returns complete Behavioral Intelligence + Paginated Chronological Timeline
 * for either an Account (userId) or an Anonymous Visitor (deviceId).
 */
export async function getProfileIntelligence({
  type,
  id,
  eventType = "ALL",
  page = 1,
  limit = 40,
}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 40));

  let baseMatch = {};
  let identity = null;
  let devices = [];
  let liveCartItems = [];
  let paidOrders = [];

  if (type === "account") {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    const userId = new mongoose.Types.ObjectId(id);
    const [user, linkedDevices, bagDoc, orders] = await Promise.all([
      User.findById(userId).select("fullName email phone role isActive createdAt lastLoginAt").lean(),
      DeviceProfile.find({ linkedUserIds: userId }).sort({ lastSeenAt: -1 }).lean(),
      Bag.findOne({ userId }).lean(),
      Order.find({ userId }).select("orderNumber status items totalPaise createdAt").lean(),
    ]);

    if (!user) return null;
    identity = {
      type: "account",
      id: String(user._id),
      title: user.fullName || "Customer",
      subtitle: user.email,
      role: user.role,
      isActive: user.isActive,
    };
    devices = linkedDevices;
    paidOrders = orders.filter((o) => PAID_ORDER_STATUSES.has(o.status));
    baseMatch = { userId };

    if (bagDoc?.items?.length) {
      const pIds = bagDoc.items.map((i) => i.productId).filter(Boolean);
      const prods = await Product.find({ _id: { $in: pIds } })
        .select("_id slug title imageMedia variants price")
        .lean();
      const pMap = new Map(prods.map((p) => [String(p._id), p]));
      liveCartItems = bagDoc.items.map((it) => {
        const prod = pMap.get(String(it.productId));
        const variant = prod?.variants?.find((v) => v.size === it.size) || prod?.variants?.[0];
        return {
          productId: it.productId,
          slug: it.slug || prod?.slug || "",
          title: it.title || prod?.title || "",
          sku: variant?.sku || "",
          primaryImage: it.image || prod?.imageMedia?.url || "",
          size: it.size || "",
          quantity: it.quantity || 1,
          price: it.price ?? prod?.price ?? 0,
          addedAt: bagDoc.updatedAt,
        };
      });
    }
  } else if (type === "visitor") {
    const profile = await DeviceProfile.findOne({
      $or: [{ deviceId: id }, { visitorCode: id }],
    })
      .populate("linkedUserIds", "fullName email")
      .lean();
    if (!profile) return null;

    identity = {
      type: "visitor",
      id: profile.deviceId,
      title: profile.visitorCode,
      subtitle: `${profile.signals?.osPlatform || "Unknown OS"} • ${profile.browserFamily || "Browser"}`,
      isHighCollisionHardware: Boolean(profile.isHighCollisionHardware),
      linkedUsers: (profile.linkedUserIds || []).map((u) => ({
        id: String(u._id),
        fullName: u.fullName,
        email: u.email,
      })),
    };
    devices = [profile];
    // Strictly show ONLY unclaimed anonymous events (never leak claimed account records back!)
    baseMatch = { deviceId: profile.deviceId, userId: null };
  } else {
    return null;
  }

  // Pull recent 500 events for intelligence scoring
  const recentEvents = await ActivityEvent.find(baseMatch)
    .sort({ occurredAt: -1 })
    .limit(500)
    .lean();

  const intelligence = await computeProfileAnalytics(recentEvents, {
    liveCartItems,
    paidOrders,
  });

  // Paginated, filterable timeline query
  const timelineFilter = { ...baseMatch };
  if (eventType && eventType !== "ALL") {
    if (eventType === "CART_CHECKOUT") {
      timelineFilter.type = { $in: ["CART_SNAPSHOT", "CHECKOUT"] };
    } else {
      timelineFilter.type = eventType;
    }
  }

  const [timelineDocs, timelineTotal] = await Promise.all([
    ActivityEvent.find(timelineFilter)
      .sort({ occurredAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .lean(),
    ActivityEvent.countDocuments(timelineFilter),
  ]);

  const timeline = timelineDocs.map((ev) => {
    const { date, time } = formatIstDateTime(ev.occurredAt || ev.createdAt);
    return {
      id: String(ev._id),
      type: ev.type,
      status: ev.status,
      actionName: ev.actionName,
      pageName: ev.pageName,
      path: ev.path,
      activeDurationSec: ev.activeDurationSec || 0,
      product: ev.product || null,
      cartItems: ev.cartItems || [],
      cartTotal: ev.cartTotal || 0,
      meta: ev.meta || {},
      mergedFromVisitor: Boolean(ev.mergedFromVisitor),
      date,
      time,
      occurredAt: ev.occurredAt || ev.createdAt,
    };
  });

  return {
    identity,
    devices: devices.map((d) => ({
      deviceId: d.deviceId,
      visitorCode: d.visitorCode,
      deviceType: d.deviceType,
      browserFamily: d.browserFamily,
      osPlatform: d.signals?.osPlatform || "Unknown",
      gpuRenderer: d.signals?.webglRenderer || "Unknown",
      isHighCollisionHardware: Boolean(d.isHighCollisionHardware),
      isSharedDevice: Array.isArray(d.linkedUserIds) && d.linkedUserIds.length > 1,
      lastSeen: formatIstDateTime(d.lastSeenAt),
    })),
    liveCartItems,
    intelligence,
    timeline,
    timelinePagination: {
      page: safePage,
      limit: safeLimit,
      total: timelineTotal,
      totalPages: Math.max(1, Math.ceil(timelineTotal / safeLimit)),
    },
  };
}