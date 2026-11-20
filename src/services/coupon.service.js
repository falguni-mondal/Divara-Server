import { Coupon } from "../models/Coupon.js";
import { CouponRedemption } from "../models/CouponRedemption.js";
import { Order } from "../models/Order.js";
import { Product } from "../models/Product.js";
import { ApiError } from "../utils/apiError.js";

/**
 * Evaluates a single coupon against the user and their hydrated bag items.
 * Returns { valid, reason, discountInr, discountPaise, eligibleSubtotalInr, coupon }.
 */
export async function evaluateCouponForBag({ coupon, user, bagItems }) {
  const now = new Date();

  if (!coupon || !coupon.isActive) {
    return { valid: false, reason: "This coupon is no longer active." };
  }

  if (coupon.startsAt && now < new Date(coupon.startsAt)) {
    return { valid: false, reason: "This coupon is not active yet." };
  }

  if (coupon.endsAt && now > new Date(coupon.endsAt)) {
    return { valid: false, reason: "This coupon has expired." };
  }

  if (coupon.maxTotalUses !== null && coupon.usedCount >= coupon.maxTotalUses) {
    return { valid: false, reason: "This coupon has reached its maximum usage limit." };
  }

  // Specific user targeting check
  const hasUserRestrictions =
    (coupon.eligibleUserIds && coupon.eligibleUserIds.length > 0) ||
    (coupon.eligibleEmails && coupon.eligibleEmails.length > 0);

  if (hasUserRestrictions) {
    const idAllowed = (coupon.eligibleUserIds || []).some(
      (id) => String(id) === String(user._id)
    );
    const emailAllowed = (coupon.eligibleEmails || []).includes(
      (user.email || "").toLowerCase()
    );
    if (!idAllowed && !emailAllowed) {
      return { valid: false, reason: "This coupon is not valid for your account." };
    }
  }

  // Per-user usage limit check (counts both RESERVED and REDEEMED to prevent race abuse)
  if (coupon.maxUsesPerUser !== null) {
    const userUses = await CouponRedemption.countDocuments({
      couponId: coupon._id,
      userId: user._id,
      status: { $in: ["RESERVED", "REDEEMED"] },
    });
    if (userUses >= coupon.maxUsesPerUser) {
      return {
        valid: false,
        reason: `You have already used this coupon the maximum ${coupon.maxUsesPerUser} time(s).`,
      };
    }
  }

  // First-order-only check
  if (coupon.firstOrderOnly) {
    const priorPaidOrder = await Order.exists({
      userId: user._id,
      status: { $in: ["PAID", "PROCESSING", "SHIPPED", "DELIVERED"] },
    });
    if (priorPaidOrder) {
      return { valid: false, reason: "This coupon is valid on your first DIVARA order only." };
    }
  }

  // Hydrate product metadata for item/category/season scoping
  const productIds = bagItems.map((i) => i.productId);
  const products = await Product.find({ _id: { $in: productIds } })
    .select("_id category season price")
    .lean();
  const productMap = new Map(products.map((p) => [String(p._id), p]));

  let totalBagSubtotal = 0;
  let totalQty = 0;
  let eligibleSubtotal = 0;

  for (const item of bagItems) {
    const prod = productMap.get(String(item.productId));
    if (!prod) continue;
    const lineTotal = prod.price * item.quantity;
    totalBagSubtotal += lineTotal;
    totalQty += item.quantity;

    let itemEligible = false;
    if (coupon.applicableTo === "ALL") {
      itemEligible = true;
    } else if (coupon.applicableTo === "SPECIFIC_PRODUCTS") {
      itemEligible = (coupon.productIds || []).some((id) => String(id) === String(prod._id));
    } else if (coupon.applicableTo === "SPECIFIC_CATEGORIES") {
      itemEligible = (coupon.categories || []).includes(prod.category);
    } else if (coupon.applicableTo === "SPECIFIC_SEASONS") {
      itemEligible = (coupon.seasons || []).includes(prod.season);
    }

    if (itemEligible) {
      eligibleSubtotal += lineTotal;
    }
  }

  if (totalQty < (coupon.minItemQuantity || 1)) {
    return {
      valid: false,
      reason: `Add at least ${coupon.minItemQuantity} item(s) to use this coupon.`,
    };
  }

  if (totalBagSubtotal < (coupon.minOrderSubtotal || 0)) {
    return {
      valid: false,
      reason: `Minimum order value of ₹${Number(coupon.minOrderSubtotal).toLocaleString("en-IN")} is required.`,
    };
  }

  if (eligibleSubtotal <= 0) {
    return {
      valid: false,
      reason: "None of the items in your bag are eligible for this coupon.",
    };
  }

  let discountInr = 0;
  if (coupon.discountType === "PERCENTAGE") {
    discountInr = Math.round((eligibleSubtotal * coupon.discountValue) / 100);
    if (coupon.maxDiscountInr && discountInr > coupon.maxDiscountInr) {
      discountInr = coupon.maxDiscountInr;
    }
  } else {
    discountInr = Math.min(eligibleSubtotal, coupon.discountValue);
  }

  return {
    valid: true,
    coupon,
    discountInr,
    discountPaise: Math.round(discountInr * 100),
    eligibleSubtotalInr: eligibleSubtotal,
  };
}

/**
 * Finds the single best AUTO-apply coupon for the user's current bag.
 */
export async function findBestAutoCoupon({ user, bagItems }) {
  const now = new Date();
  const autoCoupons = await Coupon.find({
    isActive: true,
    applyMode: "AUTO",
    startsAt: { $lte: now },
    $or: [{ endsAt: null }, { endsAt: { $gte: now } }],
  }).lean();

  let best = null;
  for (const coupon of autoCoupons) {
    const res = await evaluateCouponForBag({ coupon, user, bagItems });
    if (res.valid && (!best || res.discountInr > best.discountInr)) {
      best = res;
    }
  }
  return best;
}

/**
 * Validates a manual coupon code (throws ApiError if invalid) or picks best AUTO coupon if omitted.
 */
export async function resolveCheckoutCoupon({ user, bagItems, couponCode }) {
  if (couponCode) {
    const normalized = couponCode.trim().toUpperCase();
    const coupon = await Coupon.findOne({ code: normalized }).lean();
    if (!coupon) {
      throw ApiError.notFound(`Coupon "${normalized}" does not exist.`);
    }
    const evaluation = await evaluateCouponForBag({ coupon, user, bagItems });
    if (!evaluation.valid) {
      throw ApiError.badRequest(evaluation.reason);
    }
    return evaluation;
  }

  return findBestAutoCoupon({ user, bagItems });
}