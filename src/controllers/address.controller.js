import { User } from "../models/User.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { ApiError } from "../utils/apiError.js";

export async function listMyAddresses(req, res) {
  const user = await User.findById(req.user._id).select("addresses").lean();
  return sendSuccess(res, { data: { addresses: user?.addresses || [] } });
}

export async function addMyAddress(req, res) {
  const user = await User.findById(req.user._id);
  if (!user) throw ApiError.notFound("User not found");

  if ((user.addresses || []).length >= 8) {
    throw ApiError.badRequest("You can save up to 8 delivery addresses.");
  }

  const makeDefault = Boolean(req.body.isDefault) || user.addresses.length === 0;
  if (makeDefault) {
    user.addresses.forEach((a) => {
      a.isDefault = false;
    });
  }

  user.addresses.push({ ...req.body, isDefault: makeDefault });
  await user.save();

  return sendSuccess(res, {
    statusCode: 201,
    message: "Address saved.",
    data: { addresses: user.addresses },
  });
}

export async function updateMyAddress(req, res) {
  const user = await User.findById(req.user._id);
  if (!user) throw ApiError.notFound("User not found");

  const addr = user.addresses.id(req.params.addressId);
  if (!addr) throw ApiError.notFound("Address not found");

  if (req.body.isDefault) {
    user.addresses.forEach((a) => {
      a.isDefault = false;
    });
  }

  Object.assign(addr, req.body);
  await user.save();

  return sendSuccess(res, {
    message: "Address updated.",
    data: { addresses: user.addresses },
  });
}

export async function deleteMyAddress(req, res) {
  const user = await User.findById(req.user._id);
  if (!user) throw ApiError.notFound("User not found");

  const addr = user.addresses.id(req.params.addressId);
  if (!addr) throw ApiError.notFound("Address not found");

  const wasDefault = addr.isDefault;
  addr.deleteOne();
  if (wasDefault && user.addresses.length > 0) {
    user.addresses[0].isDefault = true;
  }
  await user.save();

  return sendSuccess(res, {
    message: "Address deleted.",
    data: { addresses: user.addresses },
  });
}