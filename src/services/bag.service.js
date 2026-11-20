import { Bag } from "../models/Bag.js";
import { Product } from "../models/Product.js";
import { ApiError } from "../utils/apiError.js";

export function formatBagResponse(bagDoc) {
  const items = (bagDoc?.items || []).map((item) => ({
    id: item.slug,
    productId: String(item.productId),
    slug: item.slug,
    title: item.title,
    category: item.category,
    size: item.size,
    price: item.price,
    quantity: item.quantity,
    image: item.image,
  }));

  const bagCount = items.reduce((sum, i) => sum + i.quantity, 0);
  const bagSubtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

  return { items, bagCount, bagSubtotal };
}

export async function getOrCreateBag(userId) {
  let bag = await Bag.findOne({ userId });
  if (!bag) {
    bag = await Bag.create({ userId, items: [] });
  }
  return bag;
}

export async function addItemToBag(userId, { productSlugOrId, size, quantity = 1 }) {
  const isObjectId = /^[a-f\d]{24}$/i.test(productSlugOrId);
  const product = await Product.findOne(
    isObjectId ? { _id: productSlugOrId, isActive: true } : { slug: productSlugOrId, isActive: true }
  ).lean();

  if (!product) {
    throw ApiError.notFound("Product not found or unavailable");
  }

  const variant = (product.variants || []).find((v) => v.size === size);
  if (!variant) {
    throw ApiError.badRequest(`Size "${size}" is not available for ${product.title}`);
  }

  const availableStock = Math.max(0, variant.stockOnHand - variant.stockReserved);
  const bag = await getOrCreateBag(userId);

  const existing = bag.items.find(
    (item) => String(item.productId) === String(product._id) && item.size === size
  );

  const nextQty = (existing ? existing.quantity : 0) + quantity;
  if (nextQty > availableStock) {
    throw ApiError.conflict(`Only ${availableStock} piece(s) left in size ${size}`);
  }

  if (existing) {
    existing.quantity = Math.min(10, nextQty);
    existing.price = product.price;
    existing.image = product.imageMedia?.url || existing.image;
  } else {
    bag.items.push({
      productId: product._id,
      slug: product.slug,
      title: product.title,
      category: product.categoryLabel,
      size,
      price: product.price,
      quantity: Math.min(10, quantity),
      image: product.imageMedia?.url || "",
    });
  }

  await bag.save();
  return formatBagResponse(bag);
}

export async function updateBagItemQuantity(userId, { productSlugOrId, size, delta }) {
  const bag = await getOrCreateBag(userId);
  const idx = bag.items.findIndex(
    (item) =>
      (item.slug === productSlugOrId || String(item.productId) === productSlugOrId) &&
      item.size === size
  );

  if (idx === -1) {
    return formatBagResponse(bag);
  }

  const target = bag.items[idx];
  const nextQty = target.quantity + delta;

  if (nextQty <= 0) {
    bag.items.splice(idx, 1);
  } else {
    const product = await Product.findById(target.productId).lean();
    const variant = product?.variants?.find((v) => v.size === size);
    const availableStock = variant ? Math.max(0, variant.stockOnHand - variant.stockReserved) : 0;

    if (nextQty > availableStock) {
      throw ApiError.conflict(`Only ${availableStock} piece(s) available in size ${size}`);
    }
    target.quantity = Math.min(10, nextQty);
  }

  await bag.save();
  return formatBagResponse(bag);
}