import { Coupon } from "../models/Coupon.js";
import { Bag } from "../models/Bag.js";
import { evaluateCouponForBag, findBestAutoCoupon } from "../services/coupon.service.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { ApiError } from "../utils/apiError.js";

export async function validateCoupon(req, res) {
  const code = req.body.code.trim().toUpperCase();
  const bag = await Bag.findOne({ userId: req.user._id }).lean();

  if (!bag || bag.items.length === 0) {
    throw ApiError.badRequest("Your shopping bag is empty.");
  }

  const coupon = await Coupon.findOne({ code }).lean();
  if (!coupon) {
    throw ApiError.notFound(`Coupon "${code}" not found.`);
  }

  const result = await evaluateCouponForBag({
    coupon,
    user: req.user,
    bagItems: bag.items,
  });

  if (!result.valid) {
    throw ApiError.badRequest(result.reason);
  }

  return sendSuccess(res, {
    message: `Coupon ${coupon.code} applied!`,
    data: {
      code: coupon.code,
      name: coupon.name,
      description: coupon.description,
      applyMode: coupon.applyMode,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      discountInr: result.discountInr,
    },
  });
}

export async function getAutoApplicableCoupon(req, res) {
  const bag = await Bag.findOne({ userId: req.user._id }).lean();
  if (!bag || bag.items.length === 0) {
    return sendSuccess(res, { data: { coupon: null } });
  }

  const best = await findBestAutoCoupon({ user: req.user, bagItems: bag.items });
  if (!best) {
    return sendSuccess(res, { data: { coupon: null } });
  }

  return sendSuccess(res, {
    data: {
      coupon: {
        code: best.coupon.code,
        name: best.coupon.name,
        description: best.coupon.description,
        applyMode: "AUTO",
        discountInr: best.discountInr,
      },
    },
  });
}

export async function adminListCoupons(_req, res) {
  const coupons = await Coupon.find().sort({ createdAt: -1 }).lean();
  return sendSuccess(res, { data: { coupons } });
}

export async function adminCreateCoupon(req, res) {
  const data = req.body;
  if (data.discountType === "PERCENTAGE" && data.discountValue > 100) {
    throw ApiError.badRequest("Percentage discount cannot exceed 100%");
  }
  if (data.endsAt && new Date(data.endsAt) <= new Date(data.startsAt)) {
    throw ApiError.badRequest("End date/time must be after start date/time");
  }

  const coupon = await Coupon.create({
    ...data,
    code: data.code.trim().toUpperCase(),
    name: data.name.trim().toUpperCase(),
  });

  return sendSuccess(res, {
    statusCode: 201,
    message: `Coupon ${coupon.code} created.`,
    data: { coupon },
  });
}

export async function adminUpdateCoupon(req, res) {
  const existing = await Coupon.findById(req.params.couponId);
  if (!existing) throw ApiError.notFound("Coupon not found");

  const updates = { ...req.body };
  if (updates.code) updates.code = updates.code.trim().toUpperCase();
  if (updates.name) updates.name = updates.name.trim().toUpperCase();

  const nextType = updates.discountType ?? existing.discountType;
  const nextVal = updates.discountValue ?? existing.discountValue;
  if (nextType === "PERCENTAGE" && Number(nextVal) > 100) {
    throw ApiError.badRequest("Percentage discount cannot exceed 100%");
  }

  const nextStart = updates.startsAt ? new Date(updates.startsAt) : existing.startsAt;
  const nextEnd =
    updates.endsAt === null
      ? null
      : updates.endsAt
      ? new Date(updates.endsAt)
      : existing.endsAt;

  if (nextEnd && nextStart && nextEnd <= nextStart) {
    throw ApiError.badRequest("End date/time must be after start date/time");
  }

  // Allowed even if existing.usedCount > 0 (edits apply to future redemptions)
  const coupon = await Coupon.findByIdAndUpdate(
    req.params.couponId,
    { $set: updates },
    { returnDocument: "after", runValidators: true }
  );

  return sendSuccess(res, {
    message: `Coupon ${coupon.code} updated.`,
    data: { coupon },
  });
}

export async function adminDeleteCoupon(req, res) {
  const deleted = await Coupon.findByIdAndDelete(req.params.couponId);
  if (!deleted) throw ApiError.notFound("Coupon not found");

  return sendSuccess(res, { message: `Coupon ${deleted.code} deleted.` });
}