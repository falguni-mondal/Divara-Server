import { User } from "../models/User.js";
import { Product } from "../models/Product.js";
import { sendSuccess } from "../utils/apiResponse.js";
import {
  getHydratedBag,
  addItemToBag,
  updateBagItemQuantity,
} from "../services/bag.service.js";
import { ApiError } from "../utils/apiError.js";
import { recordServerEvent } from "../services/activity.service.js";

async function buildCartSnapshotWithSkus(items = []) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const ids = items.map((i) => i.productId).filter(Boolean);
  const prods = await Product.find({ _id: { $in: ids } })
    .select("_id slug title imageMedia variants category fabric color price")
    .lean();
  const prodMap = new Map(prods.map((p) => [String(p._id), p]));

  return items.map((item) => {
    const prod = prodMap.get(String(item.productId));
    const variant = prod?.variants?.find((v) => v.size === item.size) || prod?.variants?.[0];
    return {
      productId: item.productId || prod?._id || null,
      slug: item.slug || prod?.slug || "",
      title: item.title || prod?.title || "",
      sku: variant?.sku || "",
      primaryImage: item.image || prod?.imageMedia?.url || "",
      size: item.size || "",
      quantity: Number(item.quantity) || 1,
      price: Number(item.price ?? prod?.price) || 0,
    };
  });
}

async function resolveProductSnapshot(slugOrId, size = "") {
  if (!slugOrId) return null;
  const isObjectId = /^[a-f\d]{24}$/i.test(String(slugOrId));
  const prod = await Product.findOne(
    isObjectId ? { _id: slugOrId } : { slug: slugOrId }
  )
    .select("_id slug title imageMedia variants category fabric color price")
    .lean();
  if (!prod) return null;

  const variant = prod.variants?.find((v) => v.size === size) || prod.variants?.[0];
  return {
    productId: prod._id,
    slug: prod.slug,
    title: prod.title,
    sku: variant?.sku || "",
    primaryImage: prod.imageMedia?.url || "",
    category: prod.category || "",
    fabric: prod.fabric || "",
    color: prod.color || "",
    size: size || variant?.size || "",
    price: prod.price || 0,
  };
}

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

  const [productSnap, cartItems] = await Promise.all([
    resolveProductSnapshot(req.body.productId, req.body.size),
    buildCartSnapshotWithSkus(data?.items || []),
  ]);

  await recordServerEvent({
    req,
    userId: req.user._id,
    type: "CART_SNAPSHOT",
    status: "SUCCESS",
    actionName: "ADD_TO_BAG",
    pageName: "Shopping Bag",
    path: "/collections",
    product: productSnap,
    cartItems,
    cartTotal: Number(data?.subtotal) || 0,
    meta: { size: req.body.size, quantityAdded: Number(req.body.quantity) || 1 },
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

  const isRemoval =
    Number(req.body.quantity) === 0 ||
    (typeof req.body.delta === "number" && req.body.delta < 0);

  const [productSnap, cartItems] = await Promise.all([
    resolveProductSnapshot(req.body.productId, req.body.size),
    buildCartSnapshotWithSkus(data?.items || []),
  ]);

  await recordServerEvent({
    req,
    userId: req.user._id,
    type: "CART_SNAPSHOT",
    status: "INFO",
    actionName: isRemoval ? "REMOVE_OR_DECREASE_BAG_ITEM" : "UPDATE_BAG_QTY",
    pageName: "Shopping Bag",
    path: "/checkout",
    product: productSnap,
    cartItems,
    cartTotal: Number(data?.subtotal) || 0,
    meta: {
      size: req.body.size,
      quantity: req.body.quantity,
      delta: req.body.delta,
    },
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

  await recordServerEvent({
    req,
    userId: req.user._id,
    type: "ACTION",
    status: "INFO",
    actionName: exists ? "WISHLIST_REMOVE" : "WISHLIST_ADD",
    pageName: "Wishlist",
    path: `/shop/${product.slug}`,
    product: {
      productId: product._id,
      slug: product.slug,
      title: product.title,
      sku: product.variants?.[0]?.sku || "",
      primaryImage: product.imageMedia?.url || "",
      category: product.category || "",
      fabric: product.fabric || "",
      color: product.color || "",
      price: product.price || 0,
    },
  });

  return sendSuccess(res, {
    data: {
      wishlist: (populated?.wishlist || []).map((p) => p.slug),
    },
  });
}