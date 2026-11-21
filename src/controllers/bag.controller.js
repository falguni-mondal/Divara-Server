import { User } from "../models/User.js";
import { Product } from "../models/Product.js";
import { sendSuccess } from "../utils/apiResponse.js";
import {
  getHydratedBag,
  addItemToBag,
  updateBagItemQuantity,
} from "../services/bag.service.js";
import { ApiError } from "../utils/apiError.js";

export async function getBag(req, res) {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  const [bagData, user] = await Promise.all([
    getHydratedBag(req.user._id),
    User.findById(req.user._id).populate("wishlist", "slug").lean(),
  ]);

  return sendSuccess(res, {
    data: {
      ...bagData,
      wishlist: (user?.wishlist || []).map((p) => p.slug),
    },
  });
}

export async function addBagItem(req, res) {
  const data = await addItemToBag(req.user._id, {
    productSlugOrId: req.body.productId,
    size: req.body.size,
    quantity: req.body.quantity,
  });
  return sendSuccess(res, { statusCode: 201, data, message: data.message });
}

export async function updateBagItem(req, res) {
  const data = await updateBagItemQuantity(req.user._id, {
    productSlugOrId: req.body.productId,
    size: req.body.size,
    quantity: req.body.quantity,
    delta: req.body.delta,
  });
  return sendSuccess(res, { data, message: data.message });
}

export async function toggleWishlistItem(req, res) {
  const slugOrId = req.body.productId;
  const isObjectId = /^[a-f\d]{24}$/i.test(slugOrId);
  const product = await Product.findOne(
    isObjectId ? { _id: slugOrId } : { slug: slugOrId }
  ).lean();

  if (!product) {
    throw ApiError.notFound("Product not found");
  }

  const user = await User.findById(req.user._id);
  const exists = user.wishlist.some((id) => String(id) === String(product._id));

  if (exists) {
    user.wishlist = user.wishlist.filter((id) => String(id) !== String(product._id));
  } else {
    user.wishlist.push(product._id);
  }

  await user.save();
  const populated = await User.findById(req.user._id).populate("wishlist", "slug").lean();

  return sendSuccess(res, {
    data: {
      wishlist: (populated?.wishlist || []).map((p) => p.slug),
    },
  });
}