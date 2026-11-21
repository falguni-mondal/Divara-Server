import { Bag } from "../models/Bag.js";
import { Product } from "../models/Product.js";
import { ApiError } from "../utils/apiError.js";

const MAX_QTY_PER_ITEM = 10;

export function formatBagResponse(bagDoc, productMap = null) {
  const items = (bagDoc?.items || []).map((item) => {
    const prod = productMap ? productMap.get(String(item.productId)) : null;
    const variant = prod?.variants?.find((v) => v.size === item.size);
    const isActive = prod ? Boolean(prod.isActive) : true;
    const availableStock = prod
      ? isActive && variant
        ? Math.max(0, (variant.stockOnHand || 0) - (variant.stockReserved || 0))
        : 0
      : null;
    const maxOrderable =
      availableStock !== null ? Math.min(MAX_QTY_PER_ITEM, availableStock) : MAX_QTY_PER_ITEM;
    const livePrice = prod?.price ?? item.price;

    let stockWarning = "";
    if (prod && !isActive) {
      stockWarning = "This garment is no longer available.";
    } else if (availableStock !== null && availableStock <= 0) {
      stockWarning = `Size ${item.size} is currently out of stock.`;
    } else if (availableStock !== null && item.quantity > availableStock) {
      stockWarning = `Only ${availableStock} piece(s) left in size ${item.size}.`;
    }

    return {
      id: item.slug,
      productId: String(item.productId),
      slug: item.slug,
      title: prod?.title || item.title,
      category: prod?.categoryLabel || item.category,
      size: item.size,
      price: livePrice,
      quantity: item.quantity,
      image: prod?.imageMedia?.url || item.image,
      availableStock,
      maxOrderable,
      isActive,
      stockWarning,
    };
  });

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

/**
 * Hydrates a user's bag with live MongoDB stock & prices.
 * Automatically syncs price changes and clamps/flags items if live stock dropped.
 */
export async function getHydratedBag(userId) {
  const bag = await getOrCreateBag(userId);
  if (!bag.items || bag.items.length === 0) {
    return formatBagResponse(bag);
  }

  const productIds = bag.items.map((i) => i.productId);
  const products = await Product.find({ _id: { $in: productIds } })
    .select("_id slug title categoryLabel price isActive imageMedia variants")
    .lean();

  const productMap = new Map(products.map((p) => [String(p._id), p]));
  let dirty = false;

  for (const item of bag.items) {
    const prod = productMap.get(String(item.productId));
    if (!prod) continue;
    if (item.price !== prod.price) {
      item.price = prod.price;
      dirty = true;
    }
    if (prod.imageMedia?.url && item.image !== prod.imageMedia.url) {
      item.image = prod.imageMedia.url;
      dirty = true;
    }
  }

  if (dirty) {
    await bag.save();
  }

  return formatBagResponse(bag, productMap);
}

export async function addItemToBag(userId, { productSlugOrId, size, quantity = 1 }) {
  const safeQty = Math.max(1, Math.min(MAX_QTY_PER_ITEM, Math.floor(Number(quantity) || 1)));
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

  const availableStock = Math.max(0, (variant.stockOnHand || 0) - (variant.stockReserved || 0));
  const maxOrderable = Math.min(MAX_QTY_PER_ITEM, availableStock);
  if (availableStock <= 0) {
    throw ApiError.conflict(`"${product.title}" (${size}) is currently out of stock.`);
  }

  const bag = await getOrCreateBag(userId);
  const existing = bag.items.find(
    (item) => String(item.productId) === String(product._id) && item.size === size
  );

  const currentInBag = existing ? existing.quantity : 0;
  const desiredQty = currentInBag + safeQty;

  let clamped = false;
  let clampMessage = "";
  const finalQty = Math.min(maxOrderable, desiredQty);

  if (desiredQty > maxOrderable) {
    if (currentInBag >= maxOrderable) {
      throw ApiError.conflict(
        `You already have the maximum available quantity (${maxOrderable}) of "${product.title}" (${size}) in your bag.`
      );
    }
    clamped = true;
    clampMessage = `Only ${availableStock} piece(s) left in size ${size}. Bag updated to ${finalQty}.`;
  }

  if (existing) {
    existing.quantity = finalQty;
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
      quantity: finalQty,
      image: product.imageMedia?.url || "",
    });
  }

  await bag.save();
  const hydrated = await getHydratedBag(userId);
  return {
    ...hydrated,
    clamped,
    maxAvailable: availableStock,
    message: clampMessage || undefined,
  };
}

/**
 * Supports idempotent absolute `quantity` (preferred for debounced UI) OR relative `delta`.
 * Always verifies live MongoDB `isActive` and `stockOnHand - stockReserved`.
 * If requested quantity exceeds live stock, clamps cleanly to `maxOrderable` and returns `{ clamped: true, maxAvailable }`.
 */
export async function updateBagItemQuantity(userId, { productSlugOrId, size, quantity, delta }) {
  const bag = await getOrCreateBag(userId);
  const idx = bag.items.findIndex(
    (item) =>
      (item.slug === productSlugOrId || String(item.productId) === productSlugOrId) &&
      item.size === size
  );

  if (idx === -1) {
    return getHydratedBag(userId);
  }

  const target = bag.items[idx];
  const requestedQty =
    typeof quantity === "number" && !Number.isNaN(quantity)
      ? Math.floor(quantity)
      : target.quantity + Math.floor(Number(delta) || 0);

  let clamped = false;
  let clampMessage = "";
  let maxAvailable = null;

  if (requestedQty <= 0) {
    bag.items.splice(idx, 1);
  } else {
    const product = await Product.findById(target.productId).lean();
    if (!product || !product.isActive) {
      bag.items.splice(idx, 1);
      await bag.save();
      const hydrated = await getHydratedBag(userId);
      return {
        ...hydrated,
        clamped: true,
        removed: true,
        maxAvailable: 0,
        message: `"${target.title}" is no longer available and was removed from your bag.`,
      };
    }

    const variant = product.variants?.find((v) => v.size === size);
    const availableStock = variant
      ? Math.max(0, (variant.stockOnHand || 0) - (variant.stockReserved || 0))
      : 0;
    const maxOrderable = Math.min(MAX_QTY_PER_ITEM, availableStock);
    maxAvailable = availableStock;

    if (availableStock <= 0) {
      clamped = true;
      clampMessage = `"${product.title}" (${size}) is now out of stock.`;
      bag.items.splice(idx, 1);
    } else if (requestedQty > maxOrderable) {
      clamped = true;
      clampMessage =
        availableStock < MAX_QTY_PER_ITEM
          ? `Only ${availableStock} piece(s) left in size ${size}. Adjusted to ${maxOrderable}.`
          : `Maximum ${MAX_QTY_PER_ITEM} pieces allowed per size.`;
      target.quantity = maxOrderable;
      target.price = product.price;
    } else {
      target.quantity = requestedQty;
      target.price = product.price;
    }
  }

  await bag.save();
  const hydrated = await getHydratedBag(userId);
  return {
    ...hydrated,
    clamped,
    maxAvailable,
    message: clampMessage || undefined,
  };
}