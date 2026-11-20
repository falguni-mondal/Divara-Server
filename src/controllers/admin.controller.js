import mongoose from "mongoose";
import {
  restoreOrderStockInSession,
  executeOrderRefundAndRestock,
} from "../services/checkout.service.js";
import { User } from "../models/User.js";
import { Product } from "../models/Product.js";
import { Order } from "../models/Order.js";
import { Review } from "../models/Review.js";
import { Newsletter } from "../models/Newsletter.js";
import { SupportTicket } from "../models/SupportTicket.js";
import { SiteContent } from "../models/SiteContent.js";
import { PolicyPage } from "../models/PolicyPage.js";
import { AdminLog } from "../models/AdminLog.js";
import { TrafficVisit } from "../models/TrafficVisit.js";
import { UtmLink } from "../models/UtmLink.js";
import { Job } from "../models/Job.js";
import { env } from "../config/env.js";
import { deleteImageKitFile } from "../config/imagekit.js";
import { appCache } from "../utils/lruCache.js";
import { logAdminAction } from "../utils/auditLogger.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { ApiError } from "../utils/apiError.js";

const PAID_STATUSES = ["PAID", "PROCESSING", "SHIPPED", "DELIVERED"];

const CATEGORY_LABELS = {
  saree: "Sarees",
  dress: "Dresses",
  denim: "Denim",
  shirt: "Shirts",
};

const PRODUCT_ALLOWED_FIELDS = [
  "title",
  "slug",
  "category",
  "categoryLabel",
  "season",
  "fabric",
  "color",
  "colorHex",
  "price",
  "description",
  "craftNotes",
  "variants",
  "galleryMedia",
  "isActive",
  "isFeatured",
  "sortOrder",
];

const CMS_ALLOWED_FIELDS = [
  "hero",
  "categories",
  "collectionBanner",
  "philosophy",
  "luxuryPillars",
  "contact",
  "trendingSearches",
];

const POLICY_ALLOWED_FIELDS = ["title", "summary", "effectiveDate", "sections"];

function pickFields(source, allowedKeys) {
  const out = {};
  for (const key of allowedKeys) {
    if (source && Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined) {
      out[key] = source[key];
    }
  }
  return out;
}

function escapeRegex(value, maxLen = 100) {
  return String(value || "")
    .trim()
    .slice(0, maxLen)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function slugifyUtm(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "");
}

function parseDateRange(fromStr, toStr, fallbackDays = 30) {
  const now = new Date();
  let end = toStr ? new Date(`${toStr}T23:59:59.999Z`) : now;
  if (Number.isNaN(end.getTime())) end = now;

  let start = fromStr
    ? new Date(`${fromStr}T00:00:00.000Z`)
    : new Date(end.getTime() - (fallbackDays - 1) * 24 * 60 * 60 * 1000);
  if (Number.isNaN(start.getTime())) {
    start = new Date(end.getTime() - (fallbackDays - 1) * 24 * 60 * 60 * 1000);
  }

  if (start > end) {
    const tmp = start;
    start = end;
    end = tmp;
  }

  const daySpan = Math.max(1, Math.min(365, Math.ceil((end - start) / (24 * 60 * 60 * 1000)) + 1));
  return { start, end, daySpan };
}

// --- 1. Rich Dashboard Overview KPIs, Smart Date Range & Attribution Telemetry ---
export async function getAdminOverview(req, res) {
  const fallbackDays = Math.min(365, Math.max(1, Number(req.query.days) || 30));
  const { start, end, daySpan } = parseDateRange(req.query.from, req.query.to, fallbackDays);
  const dateFilter = { createdAt: { $gte: start, $lte: end } };

  const [
    activeProducts,
    openTickets,
    customerCount,
    newsletterCount,
    reviewCount,
    pendingReviews,
    orderStats,
    recentOrders,
    topProductsAgg,
    categoryRevenueAgg,
    repeatCustomersAgg,
    dailyOrdersAgg,
    dailyVisitsAgg,
    visitTotalsAgg,
    sourceBreakdownAgg,
    referralBreakdownAgg,
    deviceBreakdownAgg,
    allProductsForStock,
  ] = await Promise.all([
    Product.countDocuments({ isActive: true }),
    SupportTicket.countDocuments({ status: { $ne: "RESOLVED" } }),
    User.countDocuments({ role: "customer" }),
    Newsletter.countDocuments({ isSubscribed: true }),
    Review.countDocuments({ status: "PUBLISHED" }),
    Review.countDocuments({ status: "PENDING" }),
    Order.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          revenuePaise: { $sum: "$totalPaise" },
          discountPaise: { $sum: "$discountPaise" },
        },
      },
    ]),
    Order.find(dateFilter).sort({ createdAt: -1 }).limit(8).lean(),
    Order.aggregate([
      { $match: { ...dateFilter, status: { $in: PAID_STATUSES } } },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.slug",
          title: { $first: "$items.title" },
          category: { $first: "$items.category" },
          unitsSold: { $sum: "$items.quantity" },
          revenuePaise: {
            $sum: { $multiply: ["$items.unitPricePaise", "$items.quantity"] },
          },
        },
      },
      { $sort: { revenuePaise: -1 } },
      { $limit: 6 },
    ]),
    Order.aggregate([
      { $match: { ...dateFilter, status: { $in: PAID_STATUSES } } },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.category",
          units: { $sum: "$items.quantity" },
          revenuePaise: {
            $sum: { $multiply: ["$items.unitPricePaise", "$items.quantity"] },
          },
        },
      },
      { $sort: { revenuePaise: -1 } },
    ]),
    Order.aggregate([
      { $match: { ...dateFilter, status: { $in: PAID_STATUSES } } },
      { $group: { _id: "$userId", orderCount: { $sum: 1 } } },
      {
        $group: {
          _id: null,
          totalBuyers: { $sum: 1 },
          repeatBuyers: {
            $sum: { $cond: [{ $gt: ["$orderCount", 1] }, 1, 0] },
          },
        },
      },
    ]),
    Order.aggregate([
      { $match: { ...dateFilter, status: { $in: PAID_STATUSES } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          orders: { $sum: 1 },
          revenuePaise: { $sum: "$totalPaise" },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    TrafficVisit.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          visits: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    TrafficVisit.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: null,
          totalVisits: { $sum: 1 },
          uniqueSessions: { $addToSet: "$sessionId" },
        },
      },
    ]),
    TrafficVisit.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: "$utmSource",
          visits: { $sum: 1 },
          uniqueSessions: { $addToSet: "$sessionId" },
        },
      },
      { $sort: { visits: -1 } },
      { $limit: 8 },
    ]),
    TrafficVisit.aggregate([
      { $match: { ...dateFilter, referralPerson: { $ne: "" } } },
      {
        $group: {
          _id: "$referralPerson",
          visits: { $sum: 1 },
          uniqueSessions: { $addToSet: "$sessionId" },
        },
      },
      { $sort: { visits: -1 } },
      { $limit: 10 },
    ]),
    TrafficVisit.aggregate([
      { $match: dateFilter },
      { $group: { _id: "$deviceType", count: { $sum: 1 } } },
    ]),
    Product.find({ isActive: true }).select("title slug variants").lean(),
  ]);

  const [sourceOrdersAgg, referralOrdersAgg] = await Promise.all([
    Order.aggregate([
      { $match: { ...dateFilter, status: { $in: PAID_STATUSES } } },
      {
        $group: {
          _id: { $ifNull: ["$attribution.utmSource", "direct"] },
          orders: { $sum: 1 },
          revenuePaise: { $sum: "$totalPaise" },
        },
      },
    ]),
    Order.aggregate([
      {
        $match: {
          ...dateFilter,
          status: { $in: PAID_STATUSES },
          "attribution.referralPerson": { $nin: ["", null] },
        },
      },
      {
        $group: {
          _id: "$attribution.referralPerson",
          orders: { $sum: 1 },
          revenuePaise: { $sum: "$totalPaise" },
        },
      },
    ]),
  ]);

  const paidSet = new Set(PAID_STATUSES);
  let totalOrders = 0;
  let paidOrders = 0;
  let paidRevenuePaise = 0;
  let totalDiscountPaise = 0;

  for (const row of orderStats) {
    totalOrders += row.count;
    if (paidSet.has(row._id)) {
      paidOrders += row.count;
      paidRevenuePaise += row.revenuePaise;
      totalDiscountPaise += row.discountPaise || 0;
    }
  }

  const totalVisits = visitTotalsAgg[0]?.totalVisits || 0;
  const uniqueVisitors = visitTotalsAgg[0]?.uniqueSessions?.length || 0;
  const aovInr = paidOrders > 0 ? Math.round(paidRevenuePaise / 100 / paidOrders) : 0;
  const paymentSuccessRate =
    totalOrders > 0 ? Number(((paidOrders / totalOrders) * 100).toFixed(1)) : 0;
  const visitConversionRate =
    uniqueVisitors > 0 ? Number(((paidOrders / uniqueVisitors) * 100).toFixed(2)) : 0;

  const totalBuyers = repeatCustomersAgg[0]?.totalBuyers || 0;
  const repeatBuyers = repeatCustomersAgg[0]?.repeatBuyers || 0;
  const repeatCustomerRate =
    totalBuyers > 0 ? Number(((repeatBuyers / totalBuyers) * 100).toFixed(1)) : 0;

  const trendMap = new Map();
  const chartDays = Math.min(90, daySpan);
  for (let i = chartDays - 1; i >= 0; i--) {
    const d = new Date(end.getTime() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    trendMap.set(d, { date: d.slice(5), visits: 0, orders: 0, revenueInr: 0 });
  }
  for (const row of dailyVisitsAgg) {
    const entry = trendMap.get(row._id);
    if (entry) entry.visits = row.visits;
  }
  for (const row of dailyOrdersAgg) {
    const entry = trendMap.get(row._id);
    if (entry) {
      entry.orders = row.orders;
      entry.revenueInr = Math.round(row.revenuePaise / 100);
    }
  }

  const sourceOrderMap = new Map(sourceOrdersAgg.map((r) => [r._id, r]));
  const trafficSources = sourceBreakdownAgg.map((s) => {
    const ord = sourceOrderMap.get(s._id);
    return {
      source: s._id || "direct",
      visits: s.visits,
      uniqueVisitors: s.uniqueSessions.length,
      orders: ord?.orders || 0,
      revenueInr: Math.round((ord?.revenuePaise || 0) / 100),
    };
  });

  const referralOrderMap = new Map(referralOrdersAgg.map((r) => [r._id, r]));
  const topReferrers = referralBreakdownAgg.map((r) => {
    const ord = referralOrderMap.get(r._id);
    const unique = r.uniqueSessions.length;
    const orders = ord?.orders || 0;
    return {
      person: r._id,
      visits: r.visits,
      uniqueVisitors: unique,
      orders,
      revenueInr: Math.round((ord?.revenuePaise || 0) / 100),
      conversionRate: unique > 0 ? Number(((orders / unique) * 100).toFixed(1)) : 0,
    };
  });

  const lowStockAlerts = [];
  for (const prod of allProductsForStock) {
    for (const v of prod.variants || []) {
      const available = Math.max(0, (v.stockOnHand || 0) - (v.stockReserved || 0));
      if (available <= 3) {
        lowStockAlerts.push({
          title: prod.title,
          slug: prod.slug,
          size: v.size,
          sku: v.sku,
          available,
        });
      }
    }
  }
  lowStockAlerts.sort((a, b) => a.available - b.available);

  return sendSuccess(res, {
    data: {
      range: {
        from: start.toISOString().slice(0, 10),
        to: end.toISOString().slice(0, 10),
        days: daySpan,
      },
      kpis: {
        totalRevenueInr: Math.round(paidRevenuePaise / 100),
        aovInr,
        totalOrders,
        paidOrders,
        paymentSuccessRate,
        totalVisits,
        uniqueVisitors,
        visitConversionRate,
        repeatCustomerRate,
        totalDiscountInr: Math.round(totalDiscountPaise / 100),
        activeProducts,
        openTickets,
        customers: customerCount,
        newsletterSubscribers: newsletterCount,
        approvedReviews: reviewCount,
        pendingReviews,
      },
      dailyTrend: Array.from(trendMap.values()),
      statusBreakdown: orderStats.map((s) => ({
        status: s._id,
        count: s.count,
        revenueInr: Math.round(s.revenuePaise / 100),
      })),
      categoryRevenue: categoryRevenueAgg.map((c) => ({
        category: c._id || "Other",
        units: c.units,
        revenueInr: Math.round(c.revenuePaise / 100),
      })),
      trafficSources,
      topReferrers,
      deviceBreakdown: deviceBreakdownAgg.map((d) => ({
        device: d._id || "desktop",
        count: d.count,
      })),
      topProducts: topProductsAgg.map((p) => ({
        slug: p._id,
        title: p.title,
        category: p.category,
        unitsSold: p.unitsSold,
        revenueInr: Math.round(p.revenuePaise / 100),
      })),
      lowStockAlerts: lowStockAlerts.slice(0, 12),
      recentOrders,
    },
  });
}

// --- 2. UTM & Referral Link Registry ---
export async function adminListUtmLinks(_req, res) {
  const links = await UtmLink.find().sort({ createdAt: -1 }).limit(100).lean();

  const enriched = await Promise.all(
    links.map(async (link) => {
      const visitFilter = {
        utmSource: link.utmSource,
        utmMedium: link.utmMedium,
        ...(link.utmCampaign ? { utmCampaign: link.utmCampaign } : {}),
        ...(link.referralPerson ? { referralPerson: link.referralPerson } : {}),
      };

      const orderFilter = {
        status: { $in: PAID_STATUSES },
        "attribution.utmSource": link.utmSource,
        ...(link.utmMedium ? { "attribution.utmMedium": link.utmMedium } : {}),
        ...(link.utmCampaign ? { "attribution.utmCampaign": link.utmCampaign } : {}),
        ...(link.referralPerson ? { "attribution.referralPerson": link.referralPerson } : {}),
      };

      const [visitAgg, orderAgg] = await Promise.all([
        TrafficVisit.aggregate([
          { $match: visitFilter },
          {
            $group: {
              _id: null,
              visits: { $sum: 1 },
              uniqueSessions: { $addToSet: "$sessionId" },
            },
          },
        ]),
        Order.aggregate([
          { $match: orderFilter },
          {
            $group: {
              _id: null,
              orders: { $sum: 1 },
              revenuePaise: { $sum: "$totalPaise" },
            },
          },
        ]),
      ]);

      const visits = visitAgg[0]?.visits || 0;
      const uniqueVisitors = visitAgg[0]?.uniqueSessions?.length || 0;
      const orders = orderAgg[0]?.orders || 0;
      const revenueInr = Math.round((orderAgg[0]?.revenuePaise || 0) / 100);

      return {
        ...link,
        stats: {
          visits,
          uniqueVisitors,
          orders,
          revenueInr,
          conversionRate:
            uniqueVisitors > 0 ? Number(((orders / uniqueVisitors) * 100).toFixed(1)) : 0,
        },
      };
    })
  );

  return sendSuccess(res, { data: { links: enriched } });
}

export async function adminCreateUtmLink(req, res) {
  const targetPath = (req.body.targetPath || "/").startsWith("/")
    ? req.body.targetPath.trim()
    : `/${req.body.targetPath.trim()}`;

  const utmSource = slugifyUtm(req.body.utmSource);
  const utmMedium = slugifyUtm(req.body.utmMedium);
  const utmCampaign = slugifyUtm(req.body.utmCampaign);
  const utmContent = slugifyUtm(req.body.utmContent);
  const referralPerson = slugifyUtm(req.body.referralPerson);

  const baseOrigin = (env.CLIENT_ORIGIN || "https://divara.byfalguni.com").replace(/\/+$/, "");
  const url = new URL(`${baseOrigin}${targetPath}`);
  url.searchParams.set("utm_source", utmSource);
  url.searchParams.set("utm_medium", utmMedium);
  if (utmCampaign) url.searchParams.set("utm_campaign", utmCampaign);
  if (utmContent) url.searchParams.set("utm_content", utmContent);
  if (referralPerson) url.searchParams.set("utm_ref", referralPerson);

  const link = await UtmLink.create({
    label: req.body.label.trim(),
    targetPath,
    utmSource,
    utmMedium,
    utmCampaign,
    utmContent,
    referralPerson,
    fullUrl: url.toString(),
    createdByEmail: req.user.email,
  });

  await logAdminAction(req, {
    action: "UTM_LINK_CREATED",
    targetType: "utm_link",
    targetId: link._id,
    summary: `Created UTM link "${link.label}" (${utmSource}/${utmMedium}${referralPerson ? `, ref: ${referralPerson}` : ""}).`,
  });

  return sendSuccess(res, {
    statusCode: 201,
    message: "UTM tracking link created.",
    data: { link },
  });
}

export async function adminDeleteUtmLink(req, res) {
  const deleted = await UtmLink.findByIdAndDelete(req.params.linkId);
  if (!deleted) throw ApiError.notFound("UTM link not found");

  await logAdminAction(req, {
    action: "UTM_LINK_DELETED",
    targetType: "utm_link",
    targetId: deleted._id,
    summary: `Deleted UTM link "${deleted.label}".`,
  });

  return sendSuccess(res, { message: "UTM link deleted." });
}

// --- 3. Products CRUD, Pagination, Drag-Drop Reorder & Quick Stock ---
export async function adminListProducts(req, res) {
  const exportAll = req.query.exportAll === "true" || req.query.all === "true";
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 15));
  const q = String(req.query.q || "").trim();

  const filter = {};
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    filter.$or = [
      { title: rx },
      { slug: rx },
      { categoryLabel: rx },
      { fabric: rx },
      { color: rx },
      { "variants.sku": rx },
    ];
  }

  if (exportAll) {
    const products = await Product.find(filter).sort({ sortOrder: 1, createdAt: -1 }).lean();
    return sendSuccess(res, {
      data: {
        products,
        pagination: { page: 1, limit: products.length || 1, total: products.length, totalPages: 1 },
      },
    });
  }

  const [products, total] = await Promise.all([
    Product.find(filter)
      .sort({ sortOrder: 1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Product.countDocuments(filter),
  ]);

  return sendSuccess(res, {
    data: {
      products,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    },
  });
}

export async function adminCreateProduct(req, res) {
  const safeBody = pickFields(req.body, PRODUCT_ALLOWED_FIELDS);
  const gallery = Array.isArray(safeBody.galleryMedia) ? safeBody.galleryMedia : [];
  if (gallery.length < 1 || gallery.length > 5) {
    throw ApiError.badRequest("Each product must have between 1 and 5 images.");
  }

  if (safeBody.category && CATEGORY_LABELS[safeBody.category]) {
    safeBody.categoryLabel = CATEGORY_LABELS[safeBody.category];
  }

  const maxSort = await Product.findOne().sort({ sortOrder: -1 }).select("sortOrder").lean();
  const nextSortOrder = typeof maxSort?.sortOrder === "number" ? maxSort.sortOrder + 1 : 0;

  const product = await Product.create({
    ...safeBody,
    imageMedia: gallery[0],
    galleryMedia: gallery,
    sortOrder: safeBody.sortOrder ?? nextSortOrder,
  });
  appCache.invalidatePrefix("catalog:");

  await logAdminAction(req, {
    action: "PRODUCT_CREATED",
    targetType: "product",
    targetId: product._id,
    summary: `Created product "${product.title}" (${product.slug}) at ₹${product.price}.`,
  });

  return sendSuccess(res, { statusCode: 201, message: "Product created.", data: { product } });
}

export async function adminUpdateProduct(req, res) {
  const existing = await Product.findById(req.params.productId);
  if (!existing) throw ApiError.notFound("Product not found");

  const payload = pickFields(req.body, PRODUCT_ALLOWED_FIELDS);

  if (payload.category && CATEGORY_LABELS[payload.category]) {
    payload.categoryLabel = CATEGORY_LABELS[payload.category];
  }

  if (Array.isArray(payload.galleryMedia)) {
    if (payload.galleryMedia.length < 1 || payload.galleryMedia.length > 5) {
      throw ApiError.badRequest("Each product must have between 1 and 5 images.");
    }
    payload.imageMedia = payload.galleryMedia[0];

    const newFileIds = new Set(payload.galleryMedia.map((g) => g.fileId).filter(Boolean));
    const oldFileIds = [
      existing.imageMedia?.fileId,
      ...(existing.galleryMedia || []).map((g) => g.fileId),
    ].filter((id) => id && !newFileIds.has(id));

    if (oldFileIds.length > 0) {
      await Promise.allSettled(oldFileIds.map((id) => deleteImageKitFile(id)));
    }
  }

  // Preserve active checkout stockReserved holds on existing sizes
  if (Array.isArray(payload.variants)) {
    const reservedBySize = new Map(
      (existing.variants || []).map((v) => [v.size, v.stockReserved || 0])
    );
    payload.variants = payload.variants.map((v) => {
      const held = reservedBySize.get(v.size) || 0;
      const requestedStock = Math.max(0, Math.floor(Number(v.stockOnHand) || 0));
      return {
        ...v,
        stockReserved: held,
        stockOnHand: Math.max(held, requestedStock),
      };
    });
  }

  if (typeof payload.price === "number") {
    payload.pricePaise = Math.round(payload.price * 100);
  }

  const product = await Product.findByIdAndUpdate(
    req.params.productId,
    { $set: payload },
    { returnDocument: "after", runValidators: true }
  );

  appCache.invalidatePrefix("catalog:");

  await logAdminAction(req, {
    action: "PRODUCT_UPDATED",
    targetType: "product",
    targetId: product._id,
    summary: `Updated product "${product.title}" (${product.slug}).`,
  });

  return sendSuccess(res, { message: "Product updated.", data: { product } });
}

export async function adminReorderProducts(req, res) {
  const rawIds = Array.isArray(req.body.orderedIds) ? req.body.orderedIds : [];
  const validIds = rawIds.filter((id) => mongoose.Types.ObjectId.isValid(id));

  const ops = validIds.map((id, index) => ({
    updateOne: {
      filter: { _id: id },
      update: { $set: { sortOrder: index } },
    },
  }));

  if (ops.length > 0) {
    await Product.bulkWrite(ops);
  }
  appCache.invalidatePrefix("catalog:");

  await logAdminAction(req, {
    action: "PRODUCTS_REORDERED",
    targetType: "product",
    targetId: "catalog",
    summary: `Reordered ${validIds.length} products in storefront display order.`,
  });

  return sendSuccess(res, { message: "Product display order saved." });
}

export async function adminAdjustProductStock(req, res) {
  const { size, delta, stockOnHand } = req.body;
  const product = await Product.findById(req.params.productId);
  if (!product) throw ApiError.notFound("Product not found");

  const variant = product.variants.find((v) => v.size === size);
  if (!variant) throw ApiError.notFound(`Size "${size}" not found on this product`);

  const prevStock = variant.stockOnHand;
  let nextStock = prevStock;

  if (typeof stockOnHand === "number") {
    nextStock = Math.max(variant.stockReserved, Math.floor(stockOnHand));
  } else if (typeof delta === "number") {
    nextStock = Math.max(variant.stockReserved, prevStock + delta);
  }

  variant.stockOnHand = nextStock;
  await product.save();
  appCache.invalidatePrefix("catalog:");

  await logAdminAction(req, {
    action: "STOCK_ADJUSTED",
    targetType: "product",
    targetId: product._id,
    summary: `Adjusted stock for "${product.title}" (${size}): ${prevStock} → ${nextStock}.`,
  });

  return sendSuccess(res, {
    message: "Stock updated.",
    data: { product },
  });
}

export async function adminToggleProductActive(req, res) {
  const product = await Product.findById(req.params.productId);
  if (!product) throw ApiError.notFound("Product not found");

  product.isActive = !product.isActive;
  await product.save();
  appCache.invalidatePrefix("catalog:");

  await logAdminAction(req, {
    action: "PRODUCT_VISIBILITY_TOGGLED",
    targetType: "product",
    targetId: product._id,
    summary: `Set product "${product.title}" visibility to ${product.isActive ? "Active" : "Draft (Hidden)"}.`,
  });

  return sendSuccess(res, {
    message: `"${product.title}" is now ${product.isActive ? "Active" : "Draft (Hidden)"}.`,
    data: { product },
  });
}

export async function adminDeleteProduct(req, res) {
  const product = await Product.findById(req.params.productId);
  if (!product) throw ApiError.notFound("Product not found");

  // Protect historical order records: never hard-delete a product that was ordered in the past
  const hasOrderRecord = await Order.exists({ "items.productId": product._id });
  if (hasOrderRecord) {
    product.isActive = false;
    await product.save();
    appCache.invalidatePrefix("catalog:");

    await logAdminAction(req, {
      action: "PRODUCT_ARCHIVED",
      targetType: "product",
      targetId: product._id,
      summary: `Hidden (Draft) "${product.title}" instead of deleting because past customer orders reference it.`,
    });

    return sendSuccess(res, {
      message: `"${product.title}" has past customer order records, so it was hidden (Draft) instead of permanently deleted.`,
      data: { archived: true, product },
    });
  }

  const fileIds = [
    product.imageMedia?.fileId,
    ...(product.galleryMedia || []).map((g) => g.fileId),
  ].filter(Boolean);

  await Promise.allSettled(fileIds.map((id) => deleteImageKitFile(id)));
  await Product.deleteOne({ _id: product._id });
  appCache.invalidatePrefix("catalog:");

  await logAdminAction(req, {
    action: "PRODUCT_DELETED",
    targetType: "product",
    targetId: product._id,
    summary: `Permanently deleted product "${product.title}" (${product.slug}).`,
  });

  return sendSuccess(res, {
    message: `"${product.title}" deleted permanently.`,
    data: { archived: false },
  });
}

// --- 4. Orders Management with Smart Date Filter, Search, Pagination & Full Export ---
export async function adminListOrders(req, res) {
  const { status, from, to, q } = req.query;
  const exportAll = req.query.exportAll === "true";
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 15));

  const filter = {};
  if (status && status !== "ALL") filter.status = status;

  if (from || to) {
    filter.createdAt = {};
    if (from) {
      const s = new Date(`${from}T00:00:00.000Z`);
      if (!Number.isNaN(s.getTime())) filter.createdAt.$gte = s;
    }
    if (to) {
      const e = new Date(`${to}T23:59:59.999Z`);
      if (!Number.isNaN(e.getTime())) filter.createdAt.$lte = e;
    }
    if (Object.keys(filter.createdAt).length === 0) delete filter.createdAt;
  }

  if (q && String(q).trim()) {
    const rx = new RegExp(escapeRegex(q), "i");
    filter.$or = [
      { orderNumber: rx },
      { customerEmail: rx },
      { "shippingAddress.fullName": rx },
      { "shippingAddress.phone": rx },
      { couponCode: rx },
    ];
  }

  if (exportAll) {
    const orders = await Order.find(filter).sort({ createdAt: -1 }).limit(5000).lean();
    return sendSuccess(res, {
      data: {
        orders,
        pagination: { page: 1, limit: orders.length || 1, total: orders.length, totalPages: 1 },
      },
    });
  }

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Order.countDocuments(filter),
  ]);

  return sendSuccess(res, {
    data: {
      orders,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    },
  });
}

export async function adminUpdateOrderStatus(req, res) {
  const { status, trackingNumber, courierName } = req.body;
  const order = await Order.findById(req.params.orderId);
  if (!order) throw ApiError.notFound("Order not found");

  if (status === "REFUNDED") {
    throw ApiError.badRequest(
      "Use the 'Issue Razorpay Refund' button in Order Details so the payment gateway refund is processed."
    );
  }

  if (
    ["REFUNDED", "CANCELLED"].includes(order.status) &&
    ["PAID", "PROCESSING", "SHIPPED", "DELIVERED"].includes(status)
  ) {
    throw ApiError.badRequest(
      `Cannot move a ${order.status} order back to ${status} because its stock has already been released.`
    );
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const fresh = await Order.findById(order._id).session(session);
      if (status === "CANCELLED") {
        await restoreOrderStockInSession(fresh, session);
        fresh.cancelledAt = new Date();
      }
      if (status === "SHIPPED" && !fresh.shippedAt) {
        fresh.shippedAt = new Date();
      }
      if (status === "DELIVERED" && !fresh.deliveredAt) {
        fresh.deliveredAt = new Date();
      }
      fresh.status = status;
      if (trackingNumber !== undefined) fresh.trackingNumber = trackingNumber;
      if (courierName !== undefined) fresh.courierName = courierName;
      await fresh.save({ session });
    });
  } finally {
    await session.endSession();
  }

  appCache.invalidatePrefix("catalog:");
  const updated = await Order.findById(order._id).lean();

  await Job.create({
    type: "SEND_ORDER_STATUS_UPDATE",
    idempotencyKey: `order-status-${updated.orderNumber}-${status}-${Date.now()}`,
    payload: {
      orderNumber: updated.orderNumber,
      email: updated.customerEmail,
      fullName: updated.shippingAddress?.fullName || "Valued Client",
      status,
      trackingNumber: updated.trackingNumber,
      courierName: updated.courierName,
    },
  });

  await logAdminAction(req, {
    action: "ORDER_STATUS_UPDATED",
    targetType: "order",
    targetId: updated._id,
    summary: `Updated order ${updated.orderNumber} status to ${status}${updated.stockRestored ? " (inventory restocked)" : ""}.`,
  });

  return sendSuccess(res, { message: `Order updated to ${status}.`, data: { order: updated } });
}

export async function adminReviewReturn(req, res) {
  const { decision, adminNote = "" } = req.body;
  const order = await Order.findById(req.params.orderId);
  if (!order) throw ApiError.notFound("Order not found");
  if (order.status !== "RETURN_REQUESTED") {
    throw ApiError.badRequest("This order does not have a pending return request.");
  }

  const nextStatus = decision === "APPROVE" ? "RETURN_APPROVED" : "RETURN_REJECTED";
  order.status = nextStatus;
  order.returnRequest = {
    ...(order.returnRequest?.toObject ? order.returnRequest.toObject() : order.returnRequest || {}),
    reviewedAt: new Date(),
    reviewedBy: req.user.email,
    adminNote: adminNote.trim(),
  };
  await order.save();

  await Job.create({
    type: "SEND_ORDER_STATUS_UPDATE",
    idempotencyKey: `order-return-${nextStatus}-${order.orderNumber}-${Date.now()}`,
    payload: {
      orderNumber: order.orderNumber,
      email: order.customerEmail,
      fullName: order.shippingAddress?.fullName || "Valued Client",
      status: nextStatus,
    },
  });

  await logAdminAction(req, {
    action: "ORDER_RETURN_REVIEWED",
    targetType: "order",
    targetId: order._id,
    summary: `${decision === "APPROVE" ? "Approved" : "Rejected"} return for ${order.orderNumber}.`,
  });

  return sendSuccess(res, {
    message: `Return ${decision === "APPROVE" ? "approved" : "rejected"}.`,
    data: { order },
  });
}

export async function adminRefundOrder(req, res) {
  const { reason = "Refund approved by DIVARA Atelier", restock = true } = req.body;
  const order = await executeOrderRefundAndRestock(req.params.orderId, { reason, restock });

  await logAdminAction(req, {
    action: "ORDER_REFUNDED",
    targetType: "order",
    targetId: order._id,
    summary: `Refunded order ${order.orderNumber} (₹${Math.round(order.totalPaise / 100)})${restock ? " & restocked items" : ""}.`,
  });

  return sendSuccess(res, {
    message: `Order ${order.orderNumber} refunded${restock ? " and restocked" : ""}.`,
    data: { order },
  });
}

// --- 5. CMS & Policy Pages Editor ---
export async function adminUpdateSiteContent(req, res) {
  const safeContent = pickFields(req.body, CMS_ALLOWED_FIELDS);
  const content = await SiteContent.findOneAndUpdate(
    { key: "global" },
    { $set: safeContent },
    { upsert: true, returnDocument: "after" }
  );
  appCache.invalidatePrefix("cms:");

  await logAdminAction(req, {
    action: "CMS_UPDATED",
    targetType: "site_content",
    targetId: "global",
    summary: "Updated DIVARA storefront CMS content.",
  });

  return sendSuccess(res, { message: "Site content updated.", data: { content } });
}

export async function adminUpdatePolicy(req, res) {
  const slug = req.params.slug.toLowerCase();
  const safePolicy = pickFields(req.body, POLICY_ALLOWED_FIELDS);
  const policy = await PolicyPage.findOneAndUpdate(
    { slug },
    { $set: safePolicy },
    { returnDocument: "after", runValidators: true }
  );
  if (!policy) throw ApiError.notFound("Policy page not found");

  appCache.invalidatePrefix("policies:");

  await logAdminAction(req, {
    action: "POLICY_UPDATED",
    targetType: "policy",
    targetId: slug,
    summary: `Updated legal policy "${policy.title}" (${slug}).`,
  });

  return sendSuccess(res, { message: "Policy page updated.", data: { policy } });
}

// --- 6. Immutable Admin Audit Logs (Paginated) ---
export async function adminListLogs(req, res) {
  const { email, action, status } = req.query;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));

  const filter = {};
  if (email && String(email).trim()) {
    filter.actorEmail = new RegExp(escapeRegex(email, 100), "i");
  }
  if (action && action !== "ALL") filter.action = action;
  if (status && status !== "ALL") filter.status = status;

  const [logs, total] = await Promise.all([
    AdminLog.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    AdminLog.countDocuments(filter),
  ]);

  return sendSuccess(res, {
    data: {
      logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    },
  });
}

// --- 7. Super-Admin-Only Admin Management (Strictly admin@divara.com) ---
export async function superAdminListAdmins(_req, res) {
  const admins = await User.find({ role: { $in: ["admin", "super_admin"] } })
    .select("email notificationEmail fullName role isActive lastLoginAt createdAt")
    .sort({ role: -1, createdAt: -1 })
    .lean();

  return sendSuccess(res, { data: { admins } });
}

export async function superAdminCreateAdmin(req, res) {
  const email = req.body.email.toLowerCase().trim();
  const notificationEmail = req.body.notificationEmail?.toLowerCase().trim() || email;

  const existing = await User.findOne({ email });
  if (existing) {
    throw ApiError.conflict(`An account with email "${email}" already exists.`);
  }

  const admin = new User({
    email,
    notificationEmail,
    fullName: req.body.fullName.trim(),
    role: "admin",
    authProvider: "local",
    isActive: true,
  });
  await admin.setPassword(req.body.password);
  await admin.save();

  await logAdminAction(req, {
    action: "ADMIN_CREATED",
    targetType: "admin_user",
    targetId: admin._id,
    summary: `Super Admin created new admin account ${admin.email} (OTP inbox: ${notificationEmail}).`,
  });

  return sendSuccess(res, {
    statusCode: 201,
    message: `Admin account ${admin.email} created.`,
    data: {
      admin: {
        _id: admin._id,
        email: admin.email,
        notificationEmail: admin.notificationEmail,
        fullName: admin.fullName,
        role: admin.role,
        isActive: admin.isActive,
      },
    },
  });
}

export async function superAdminToggleAdmin(req, res) {
  const target = await User.findById(req.params.adminId);
  if (!target || target.role !== "admin") {
    throw ApiError.notFound("Admin account not found (Super Admin cannot be modified)");
  }

  target.isActive = !target.isActive;
  await target.save();

  await logAdminAction(req, {
    action: "ADMIN_TOGGLED",
    targetType: "admin_user",
    targetId: target._id,
    summary: `Super Admin ${target.isActive ? "activated" : "deactivated"} admin ${target.email}.`,
  });

  return sendSuccess(res, {
    message: `Admin ${target.email} is now ${target.isActive ? "active" : "deactivated"}.`,
    data: { isActive: target.isActive },
  });
}

export async function superAdminDeleteAdmin(req, res) {
  const target = await User.findById(req.params.adminId);
  if (!target || target.role !== "admin") {
    throw ApiError.notFound("Admin account not found (Super Admin cannot be deleted)");
  }

  await User.deleteOne({ _id: target._id });

  await logAdminAction(req, {
    action: "ADMIN_DELETED",
    targetType: "admin_user",
    targetId: target._id,
    summary: `Super Admin permanently deleted admin ${target.email}.`,
  });

  return sendSuccess(res, { message: `Admin ${target.email} deleted.` });
}