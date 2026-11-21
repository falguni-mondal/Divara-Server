import { Product } from "../models/Product.js";
import { appCache } from "../utils/lruCache.js";
import { ApiError } from "../utils/apiError.js";

const MAX_QTY_PER_ITEM = 10;

function parseCsvList(val) {
  if (!val || val === "all" || val === "All") return [];
  return String(val)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && s.toLowerCase() !== "all");
}

function toExactCaseInsensitiveRegexList(values) {
  return values.map((v) => {
    const escaped = v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^${escaped}$`, "i");
  });
}

function buildSortStage(sortKey) {
  switch (sortKey) {
    case "price-asc":
      return { price: 1, sortOrder: 1 };
    case "price-desc":
      return { price: -1, sortOrder: 1 };
    case "name-asc":
      return { title: 1 };
    case "featured":
    default:
      return { isFeatured: -1, sortOrder: 1, createdAt: -1 };
  }
}

function buildComprehensiveSearchFilter(rawQuery) {
  const clean = String(rawQuery || "").trim();
  if (!clean) return null;

  const tokens = clean
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 6);

  if (tokens.length === 0) return null;

  const tokenClauses = tokens.map((token) => {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rx = new RegExp(escaped, "i");
    const orList = [
      { title: rx },
      { slug: rx },
      { category: rx },
      { categoryLabel: rx },
      { season: rx },
      { fabric: rx },
      { color: rx },
      { description: rx },
      { craftNotes: rx },
      { "variants.sku": rx },
      { "variants.size": rx },
    ];

    const numeric = Number(token.replace(/[₹,]/g, ""));
    if (!Number.isNaN(numeric) && numeric >= 1000 && numeric <= 500000) {
      orList.push({ price: { $gte: numeric - 2500, $lte: numeric + 2500 } });
    }

    return { $or: orList };
  });

  return tokenClauses.length === 1 ? tokenClauses[0] : { $and: tokenClauses };
}

export async function queryCatalog(queryParams = {}) {
  const categories = parseCsvList(queryParams.category).map((c) => c.toLowerCase());
  const seasons = parseCsvList(queryParams.season);
  const colors = parseCsvList(queryParams.color);
  const fabrics = parseCsvList(queryParams.fabric);
  const sizes = parseCsvList(queryParams.size);

  const hasMinPrice =
    queryParams.minPrice !== undefined &&
    queryParams.minPrice !== "" &&
    !Number.isNaN(Number(queryParams.minPrice));
  const hasMaxPrice =
    queryParams.maxPrice !== undefined &&
    queryParams.maxPrice !== "" &&
    !Number.isNaN(Number(queryParams.maxPrice));

  const minPrice = hasMinPrice ? Math.max(0, Number(queryParams.minPrice)) : null;
  const maxPrice = hasMaxPrice ? Math.max(0, Number(queryParams.maxPrice)) : null;
  const search = String(queryParams.q || "").trim();
  const sort = String(queryParams.sort || "featured");
  const page = Math.max(1, Number(queryParams.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(queryParams.limit) || 24));

  const cacheKey = `catalog:list:${JSON.stringify({
    categories,
    seasons: seasons.map((s) => s.toLowerCase()),
    colors: colors.map((c) => c.toLowerCase()),
    fabrics: fabrics.map((f) => f.toLowerCase()),
    sizes,
    minPrice,
    maxPrice,
    search: search.toLowerCase(),
    sort,
    page,
    limit,
  })}`;

  const cached = appCache.get(cacheKey);
  if (cached) return cached;

  const match = { isActive: true };

  if (minPrice !== null || maxPrice !== null) {
    match.price = {};
    if (minPrice !== null) match.price.$gte = minPrice;
    if (maxPrice !== null) match.price.$lte = maxPrice;
  }

  if (categories.length > 0) match.category = { $in: categories };
  if (seasons.length > 0) match.season = { $in: toExactCaseInsensitiveRegexList(seasons) };
  if (colors.length > 0) match.color = { $in: toExactCaseInsensitiveRegexList(colors) };
  if (fabrics.length > 0) match.fabric = { $in: toExactCaseInsensitiveRegexList(fabrics) };
  if (sizes.length > 0) {
    match.variants = { $elemMatch: { size: { $in: sizes } } };
  }

  const searchClause = buildComprehensiveSearchFilter(search);
  if (searchClause) {
    Object.assign(match, searchClause);
  }

  const [aggResult] = await Product.aggregate([
    { $match: match },
    {
      $facet: {
        items: [
          { $sort: buildSortStage(sort) },
          { $skip: (page - 1) * limit },
          { $limit: limit },
        ],
        totalCount: [{ $count: "total" }],
        categories: [{ $sortByCount: "$category" }],
        seasons: [{ $sortByCount: "$season" }],
        colors: [{ $sortByCount: "$color" }],
        fabrics: [{ $sortByCount: "$fabric" }],
        priceStats: [
          {
            $group: {
              _id: null,
              min: { $min: "$price" },
              max: { $max: "$price" },
            },
          },
        ],
      },
    },
  ]);

  const total = aggResult?.totalCount?.[0]?.total || 0;
  const items = (aggResult?.items || []).map((doc) => Product.toFrontendDTO(doc));
  const stats = aggResult?.priceStats?.[0];

  const result = {
    items,
    facets: {
      categories: aggResult?.categories || [],
      seasons: aggResult?.seasons || [],
      colors: aggResult?.colors || [],
      fabrics: aggResult?.fabrics || [],
      priceBounds: {
        min: stats?.min ?? 0,
        max: stats?.max ?? 150000,
      },
    },
    meta: {
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };

  appCache.set(cacheKey, result, 120_000);
  return result;
}

export async function getProductBySlug(slug) {
  const cleanSlug = String(slug || "").toLowerCase().trim();
  const cacheKey = `catalog:slug:${cleanSlug}`;
  const cached = appCache.get(cacheKey);
  if (cached) return cached;

  const doc = await Product.findOne({ slug: cleanSlug, isActive: true }).lean();
  if (!doc) {
    throw ApiError.notFound("Garment not found in the DIVARA archive");
  }

  const relatedDocs = await Product.find({
    _id: { $ne: doc._id },
    isActive: true,
    $or: [{ category: doc.category }, { season: doc.season }],
  })
    .sort({ isFeatured: -1, sortOrder: 1 })
    .limit(4)
    .lean();

  const result = {
    product: Product.toFrontendDTO(doc),
    related: relatedDocs.map((r) => Product.toFrontendDTO(r)),
  };

  appCache.set(cacheKey, result, 60_000);
  return result;
}

/**
 * Uncached live stock lookup directly from MongoDB for PDP initial check & debounced quantity checks.
 */
export async function getProductLiveStock(slugOrId) {
  const clean = String(slugOrId || "").trim();
  const isObjectId = /^[a-f\d]{24}$/i.test(clean);

  const doc = await Product.findOne(
    isObjectId ? { _id: clean } : { slug: clean.toLowerCase() }
  )
    .select("_id slug title price isActive variants")
    .lean();

  if (!doc) {
    throw ApiError.notFound("Garment not found in the DIVARA archive");
  }

  const variants = (doc.variants || []).map((v) => {
    const availableStock = doc.isActive
      ? Math.max(0, (v.stockOnHand || 0) - (v.stockReserved || 0))
      : 0;
    return {
      size: v.size,
      sku: v.sku,
      availableStock,
      maxOrderable: Math.min(MAX_QTY_PER_ITEM, availableStock),
      inStock: availableStock > 0,
    };
  });

  return {
    productId: String(doc._id),
    slug: doc.slug,
    isActive: Boolean(doc.isActive),
    price: doc.price,
    variants,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Uncached batch stock validation for PDP quantity input, Cart Drawer, and pre-checkout checks.
 * Never cached — always reads fresh MongoDB stockOnHand - stockReserved.
 */
export async function validateBulkStock(items = []) {
  if (!Array.isArray(items) || items.length === 0) {
    return { allValid: true, results: [], checkedAt: new Date().toISOString() };
  }

  const ids = [];
  const slugs = [];
  for (const item of items) {
    const key = String(item.productId || item.slug || "").trim();
    if (/^[a-f\d]{24}$/i.test(key)) ids.push(key);
    else if (key) slugs.push(key.toLowerCase());
  }

  const orQuery = [];
  if (ids.length > 0) orQuery.push({ _id: { $in: ids } });
  if (slugs.length > 0) orQuery.push({ slug: { $in: slugs } });

  const docs =
    orQuery.length > 0
      ? await Product.find({ $or: orQuery })
          .select("_id slug title price isActive variants")
          .lean()
      : [];

  const byId = new Map(docs.map((d) => [String(d._id), d]));
  const bySlug = new Map(docs.map((d) => [d.slug, d]));

  let allValid = true;
  const results = items.map((item) => {
    const rawKey = String(item.productId || item.slug || "").trim();
    const doc = byId.get(rawKey) || bySlug.get(rawKey.toLowerCase()) || null;
    const requestedQty = Math.max(1, Math.floor(Number(item.quantity) || 1));

    if (!doc || !doc.isActive) {
      allValid = false;
      return {
        productId: rawKey,
        slug: doc?.slug || rawKey,
        size: item.size,
        requestedQty,
        availableStock: 0,
        maxOrderable: 0,
        clampedQty: 0,
        valid: false,
        inStock: false,
        isActive: false,
        price: doc?.price ?? null,
        message: "This garment is no longer available.",
      };
    }

    const variant = (doc.variants || []).find((v) => v.size === item.size);
    const availableStock = variant
      ? Math.max(0, (variant.stockOnHand || 0) - (variant.stockReserved || 0))
      : 0;
    const maxOrderable = Math.min(MAX_QTY_PER_ITEM, availableStock);
    const clampedQty = Math.min(requestedQty, maxOrderable);
    const valid = availableStock > 0 && requestedQty <= maxOrderable;

    if (!valid) allValid = false;

    let message = "";
    if (availableStock <= 0) {
      message = `"${doc.title}" (${item.size}) is currently out of stock.`;
    } else if (requestedQty > availableStock) {
      message = `Only ${availableStock} piece(s) left in size ${item.size}. Quantity adjusted to ${clampedQty}.`;
    } else if (requestedQty > MAX_QTY_PER_ITEM) {
      message = `Maximum ${MAX_QTY_PER_ITEM} pieces allowed per size.`;
    }

    return {
      productId: String(doc._id),
      slug: doc.slug,
      title: doc.title,
      size: item.size,
      requestedQty,
      availableStock,
      maxOrderable,
      clampedQty,
      valid,
      inStock: availableStock > 0,
      isActive: true,
      price: doc.price,
      message,
    };
  });

  return {
    allValid,
    results,
    checkedAt: new Date().toISOString(),
  };
}

export async function instantSearchCatalog(q, limit = 8) {
  const clean = (q || "").trim();
  if (!clean) return { matches: [], totalMatches: 0 };

  const safeLimit = Math.min(24, Math.max(1, Number(limit) || 8));
  const cacheKey = `catalog:search:${clean.toLowerCase()}:${safeLimit}`;
  const cached = appCache.get(cacheKey);
  if (cached) return cached;

  const searchClause = buildComprehensiveSearchFilter(clean);
  const filter = {
    isActive: true,
    ...(searchClause || {}),
  };

  const [docs, totalMatches] = await Promise.all([
    Product.find(filter).sort({ isFeatured: -1, sortOrder: 1 }).limit(safeLimit).lean(),
    Product.countDocuments(filter),
  ]);

  const result = {
    matches: docs.map((d) => Product.toFrontendDTO(d)),
    totalMatches,
  };

  appCache.set(cacheKey, result, 180_000);
  return result;
}