import mongoose from "mongoose";
import { User } from "../models/User.js";
import { Bag } from "../models/Bag.js";
import { Order } from "../models/Order.js";
import { SupportTicket } from "../models/SupportTicket.js";
import { Review } from "../models/Review.js";
import { RefreshToken } from "../models/RefreshToken.js";
import { logAdminAction } from "../utils/auditLogger.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { ApiError } from "../utils/apiError.js";

const PAID_STATUSES = ["PAID", "PROCESSING", "SHIPPED", "DELIVERED"];

function escapeRegex(value, maxLen = 100) {
  return String(value || "")
    .trim()
    .slice(0, maxLen)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertCustomerObjectId(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw ApiError.badRequest("Invalid user ID");
  }
}

// GET /api/v1/admin/users
export async function adminListUsers(req, res) {
  const { q = "", status = "ALL" } = req.query;
  const exportAll = req.query.exportAll === "true";
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 15));

  const filter = { role: "customer" };
  if (status === "ACTIVE") filter.isActive = true;
  if (status === "BANNED") filter.isActive = false;

  if (String(q).trim()) {
    const rx = new RegExp(escapeRegex(q), "i");
    filter.$or = [{ fullName: rx }, { email: rx }, { phone: rx }];
  }

  const query = User.find(filter)
    .select("email fullName phone avatarUrl authProvider isActive lastLoginAt addresses createdAt")
    .sort({ createdAt: -1 });

  const [users, total] = await Promise.all([
    exportAll ? query.limit(5000).lean() : query.skip((page - 1) * limit).limit(limit).lean(),
    User.countDocuments(filter),
  ]);

  const userIds = users.map((u) => u._id);

  const [orderAgg, bagDocs, ticketAgg] = await Promise.all([
    Order.aggregate([
      { $match: { userId: { $in: userIds } } },
      {
        $group: {
          _id: "$userId",
          orderCount: { $sum: 1 },
          paidOrderCount: {
            $sum: { $cond: [{ $in: ["$status", PAID_STATUSES] }, 1, 0] },
          },
          totalSpentPaise: {
            $sum: { $cond: [{ $in: ["$status", PAID_STATUSES] }, "$totalPaise", 0] },
          },
          lastOrderAt: { $max: "$createdAt" },
        },
      },
    ]),
    Bag.find({ userId: { $in: userIds } }).select("userId items").lean(),
    SupportTicket.aggregate([
      { $match: { userId: { $in: userIds } } },
      { $group: { _id: "$userId", ticketCount: { $sum: 1 } } },
    ]),
  ]);

  const orderMap = new Map(orderAgg.map((o) => [String(o._id), o]));
  const bagMap = new Map(bagDocs.map((b) => [String(b.userId), b.items || []]));
  const ticketMap = new Map(ticketAgg.map((t) => [String(t._id), t.ticketCount]));

  const enriched = users.map((u) => {
    const idStr = String(u._id);
    const ord = orderMap.get(idStr);
    const bagItems = bagMap.get(idStr) || [];
    const cartItemCount = bagItems.reduce((sum, i) => sum + (i.quantity || 1), 0);
    const cartValueInr = bagItems.reduce(
      (sum, i) => sum + (i.price || 0) * (i.quantity || 1),
      0
    );

    return {
      ...u,
      stats: {
        orderCount: ord?.orderCount || 0,
        paidOrderCount: ord?.paidOrderCount || 0,
        totalSpentInr: Math.round((ord?.totalSpentPaise || 0) / 100),
        lastOrderAt: ord?.lastOrderAt || null,
        cartItemCount,
        cartValueInr,
        addressesCount: (u.addresses || []).length,
        ticketCount: ticketMap.get(idStr) || 0,
      },
    };
  });

  return sendSuccess(res, {
    data: {
      users: enriched,
      pagination: {
        page: exportAll ? 1 : page,
        limit: exportAll ? enriched.length || 1 : limit,
        total,
        totalPages: exportAll ? 1 : Math.max(1, Math.ceil(total / limit)),
      },
    },
  });
}

// GET /api/v1/admin/users/:userId
export async function adminGetUserDetail(req, res) {
  assertCustomerObjectId(req.params.userId);

  const user = await User.findOne({ _id: req.params.userId, role: "customer" })
    .select("email fullName phone avatarUrl authProvider isActive lastLoginAt addresses createdAt updatedAt")
    .lean();

  if (!user) throw ApiError.notFound("Customer account not found");

  const [bag, orders, tickets, reviews, activeSessions] = await Promise.all([
    Bag.findOne({ userId: user._id }).lean(),
    Order.find({ userId: user._id }).sort({ createdAt: -1 }).limit(50).lean(),
    SupportTicket.find({
      $or: [{ userId: user._id }, { email: user.email }],
    })
      .sort({ createdAt: -1 })
      .limit(30)
      .lean(),
    Review.find({ userId: user._id }).sort({ createdAt: -1 }).limit(30).lean(),
    RefreshToken.countDocuments({
      userId: user._id,
      isRevoked: false,
      expiresAt: { $gt: new Date() },
    }),
  ]);

  const paidOrders = orders.filter((o) => PAID_STATUSES.includes(o.status));
  const totalSpentInr = Math.round(
    paidOrders.reduce((sum, o) => sum + (o.totalPaise || 0), 0) / 100
  );
  const bagItems = bag?.items || [];
  const cartValueInr = bagItems.reduce(
    (sum, i) => sum + (i.price || 0) * (i.quantity || 1),
    0
  );

  return sendSuccess(res, {
    data: {
      user,
      summary: {
        totalOrders: orders.length,
        paidOrders: paidOrders.length,
        totalSpentInr,
        cartItemCount: bagItems.reduce((s, i) => s + (i.quantity || 1), 0),
        cartValueInr,
        activeSessions,
        reviewsCount: reviews.length,
        ticketsCount: tickets.length,
      },
      cart: bagItems,
      orders,
      tickets,
      reviews,
    },
  });
}

// POST /api/v1/admin/users
export async function adminCreateUser(req, res) {
  const email = req.body.email.toLowerCase().trim();
  const existing = await User.findOne({ email });
  if (existing) {
    throw ApiError.conflict(`An account with email "${email}" already exists.`);
  }

  const customer = new User({
    email,
    fullName: req.body.fullName.trim(),
    phone: (req.body.phone || "").trim(),
    role: "customer",
    authProvider: "local",
    isActive: true,
  });
  await customer.setPassword(req.body.password);
  await customer.save();

  await logAdminAction(req, {
    action: "USER_CREATED",
    targetType: "user",
    targetId: customer._id,
    summary: `Created customer account ${customer.email} (${customer.fullName}).`,
  });

  return sendSuccess(res, {
    statusCode: 201,
    message: `Customer account ${customer.email} created.`,
    data: {
      user: {
        _id: customer._id,
        email: customer.email,
        fullName: customer.fullName,
        phone: customer.phone,
        isActive: customer.isActive,
        createdAt: customer.createdAt,
      },
    },
  });
}

// PATCH /api/v1/admin/users/:userId
export async function adminUpdateUser(req, res) {
  assertCustomerObjectId(req.params.userId);

  const user = await User.findOne({ _id: req.params.userId, role: "customer" });
  if (!user) throw ApiError.notFound("Customer account not found");

  if (typeof req.body.fullName === "string") user.fullName = req.body.fullName.trim();
  if (typeof req.body.phone === "string") user.phone = req.body.phone.trim();
  await user.save();

  await logAdminAction(req, {
    action: "USER_UPDATED",
    targetType: "user",
    targetId: user._id,
    summary: `Updated customer profile for ${user.email}.`,
  });

  return sendSuccess(res, {
    message: "Customer profile updated.",
    data: {
      user: {
        _id: user._id,
        email: user.email,
        fullName: user.fullName,
        phone: user.phone,
        isActive: user.isActive,
      },
    },
  });
}

// PATCH /api/v1/admin/users/:userId/toggle-ban
export async function adminToggleUserBan(req, res) {
  assertCustomerObjectId(req.params.userId);

  const user = await User.findOne({ _id: req.params.userId, role: "customer" });
  if (!user) throw ApiError.notFound("Customer account not found");

  user.isActive = !user.isActive;
  if (!user.isActive) {
    user.tokenVersion = Number(user.tokenVersion || 0) + 1;
  }
  await user.save();

  // Immediately revoke all active sessions if banned
  if (!user.isActive) {
    await RefreshToken.updateMany({ userId: user._id }, { $set: { isRevoked: true } });
  }

  await logAdminAction(req, {
    action: user.isActive ? "USER_UNBANNED" : "USER_BANNED",
    targetType: "user",
    targetId: user._id,
    summary: `${user.isActive ? "Unbanned" : "Banned & revoked sessions for"} customer ${user.email}.`,
  });

  return sendSuccess(res, {
    message: `${user.email} is now ${user.isActive ? "Active (Unbanned)" : "Banned / Blocked"}.`,
    data: { isActive: user.isActive },
  });
}

// POST /api/v1/admin/users/:userId/revoke-sessions
export async function adminRevokeUserSessions(req, res) {
  assertCustomerObjectId(req.params.userId);

  const user = await User.findOne({ _id: req.params.userId, role: "customer" });
  if (!user) throw ApiError.notFound("Customer account not found");

  const [result] = await Promise.all([
    RefreshToken.updateMany(
      { userId: user._id, isRevoked: false },
      { $set: { isRevoked: true } }
    ),
    User.updateOne({ _id: user._id }, { $inc: { tokenVersion: 1 } }),
  ]);

  await logAdminAction(req, {
    action: "USER_SESSIONS_REVOKED",
    targetType: "user",
    targetId: user._id,
    summary: `Forced sign-out across ${result.modifiedCount || 0} active session(s) for ${user.email}.`,
  });

  return sendSuccess(res, {
    message: `Signed out ${user.email} from all active devices.`,
    data: { revokedCount: result.modifiedCount || 0 },
  });
}

// DELETE /api/v1/admin/users/:userId/cart
export async function adminClearUserCart(req, res) {
  assertCustomerObjectId(req.params.userId);

  const user = await User.findOne({ _id: req.params.userId, role: "customer" });
  if (!user) throw ApiError.notFound("Customer account not found");

  await Bag.updateOne({ userId: user._id }, { $set: { items: [] } });

  await logAdminAction(req, {
    action: "USER_CART_CLEARED",
    targetType: "user",
    targetId: user._id,
    summary: `Cleared shopping cart for ${user.email}.`,
  });

  return sendSuccess(res, { message: `Cleared cart for ${user.email}.` });
}

// DELETE /api/v1/admin/users/:userId
export async function adminDeleteUser(req, res) {
  assertCustomerObjectId(req.params.userId);

  const user = await User.findOne({ _id: req.params.userId, role: "customer" });
  if (!user) throw ApiError.notFound("Customer account not found");

  await Promise.all([
    Bag.deleteOne({ userId: user._id }),
    RefreshToken.deleteMany({ userId: user._id }),
    User.deleteOne({ _id: user._id }),
  ]);

  await logAdminAction(req, {
    action: "USER_DELETED",
    targetType: "user",
    targetId: user._id,
    summary: `Permanently deleted customer account ${user.email} (historical GST orders preserved).`,
  });

  return sendSuccess(res, {
    message: `Customer ${user.email} deleted permanently.`,
  });
}