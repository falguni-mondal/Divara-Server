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

function slugifyUtm(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "");
}

// --- 1. Rich Dashboard Overview KPIs, Traffic & Attribution Telemetry ---
export async function getAdminOverview(req, res) {
  const days = Math.min(90, Math.max(7, Number(req.query.days) || 30));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [
    activeProducts,
    openTickets,
    customerCount,
    newsletterCount,
    reviewCount,
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
    Newsletter.countDocuments({ status: "SUBSCRIBED" }),
    Review.countDocuments({ isApproved: true }),
    Order.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          revenuePaise: { $sum: "$totalPaise" },
          discountPaise: { $sum: "$discountPaise" },
        },
      },
    ]),
    Order.find().sort({ createdAt: -1 }).limit(8).lean(),
    Order.aggregate([
      { $match: { status: { $in: PAID_STATUSES } } },
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
      { $match: { status: { $in: PAID_STATUSES } } },
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
      { $match: { status: { $in: PAID_STATUSES } } },
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
      { $match: { createdAt: { $gte: since }, status: { $in: PAID_STATUSES } } },
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
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          visits: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    TrafficVisit.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: null,
          totalVisits: { $sum: 1 },
          uniqueSessions: { $addToSet: "$sessionId" },
        },
      },
    ]),
    TrafficVisit.aggregate([
      { $match: { createdAt: { $gte: since } } },
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
      { $match: { createdAt: { $gte: since }, referralPerson: { $ne: "" } } },
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
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: "$deviceType", count: { $sum: 1 } } },
    ]),
    Product.find({ isActive: true }).select("title slug variants").lean(),
  ]);

  // Order attribution by source & referral person
  const [sourceOrdersAgg, referralOrdersAgg] = await Promise.all([
    Order.aggregate([
      { $match: { createdAt: { $gte: since }, status: { $in: PAID_STATUSES } } },
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
          createdAt: { $gte: since },
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

  // Merge daily orders + visits into unified trend series
  const trendMap = new Map();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
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
      days,
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

// --- 2. UTM & Referral Link Registry (Generator + Live Attribution Metrics) ---
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

// --- 3. Products CRUD (with ImageKit cleanup & Audit Logging) ---
export async function adminListProducts(_req, res) {
  const products = await Product.find().sort({ sortOrder: 1, createdAt: -1 }).lean();
  return sendSuccess(res, { data: { products } });
}

export async function adminCreateProduct(req, res) {
  const product = await Product.create(req.body);
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
  const product = await Product.findByIdAndUpdate(
    req.params.productId,
    { $set: req.body },
    { returnDocument: "after", runValidators: true }
  );
  if (!product) throw ApiError.notFound("Product not found");

  appCache.invalidatePrefix("catalog:");

  await logAdminAction(req, {
    action: "PRODUCT_UPDATED",
    targetType: "product",
    targetId: product._id,
    summary: `Updated product "${product.title}" (${product.slug}).`,
  });

  return sendSuccess(res, { message: "Product updated.", data: { product } });
}

export async function adminDeleteProduct(req, res) {
  const product = await Product.findById(req.params.productId);
  if (!product) throw ApiError.notFound("Product not found");

  const fileIds = [
    product.imageMedia?.fileId,
    ...(product.galleryMedia || []).map((g) => g.fileId),
  ].filter(Boolean);

  await Promise.all(fileIds.map((id) => deleteImageKitFile(id)));
  await Product.deleteOne({ _id: product._id });
  appCache.invalidatePrefix("catalog:");

  await logAdminAction(req, {
    action: "PRODUCT_DELETED",
    targetType: "product",
    targetId: product._id,
    summary: `Deleted product "${product.title}" (${product.slug}).`,
  });

  return sendSuccess(res, { message: "Product deleted." });
}

// --- 4. Orders Management & Customer Status Email ---
export async function adminListOrders(req, res) {
  const filter = req.query.status && req.query.status !== "ALL" ? { status: req.query.status } : {};
  const orders = await Order.find(filter).sort({ createdAt: -1 }).limit(100).lean();
  return sendSuccess(res, { data: { orders } });
}

export async function adminUpdateOrderStatus(req, res) {
  const { status, trackingNumber, courierName } = req.body;
  const order = await Order.findByIdAndUpdate(
    req.params.orderId,
    {
      $set: {
        status,
        ...(trackingNumber !== undefined ? { trackingNumber } : {}),
        ...(courierName !== undefined ? { courierName } : {}),
      },
    },
    { returnDocument: "after" }
  );
  if (!order) throw ApiError.notFound("Order not found");

  await Job.create({
    type: "SEND_ORDER_STATUS_UPDATE",
    idempotencyKey: `order-status-${order.orderNumber}-${status}-${Date.now()}`,
    payload: {
      orderNumber: order.orderNumber,
      email: order.customerEmail,
      fullName: order.shippingAddress?.fullName || "Valued Client",
      status,
      trackingNumber: order.trackingNumber,
      courierName: order.courierName,
    },
  });

  await logAdminAction(req, {
    action: "ORDER_STATUS_UPDATED",
    targetType: "order",
    targetId: order._id,
    summary: `Updated order ${order.orderNumber} status to ${status}.`,
  });

  return sendSuccess(res, { message: `Order updated to ${status}.`, data: { order } });
}

// --- 5. CMS & Policy Pages Editor ---
export async function adminUpdateSiteContent(req, res) {
  const content = await SiteContent.findOneAndUpdate(
    { key: "global" },
    { $set: req.body },
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
  const policy = await PolicyPage.findOneAndUpdate(
    { slug },
    { $set: req.body },
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

// --- 6. Immutable Admin Audit Logs ---
export async function adminListLogs(req, res) {
  const { email, action, status, limit = 100 } = req.query;
  const filter = {};
  if (email) filter.actorEmail = new RegExp(String(email).trim(), "i");
  if (action && action !== "ALL") filter.action = action;
  if (status && status !== "ALL") filter.status = status;

  const logs = await AdminLog.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(250, Number(limit) || 100))
    .lean();

  return sendSuccess(res, { data: { logs } });
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