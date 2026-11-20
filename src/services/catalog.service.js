import { Product } from "../models/Product.js";
import { appCache } from "../utils/lruCache.js";
import { ApiError } from "../utils/apiError.js";

function parseCsvList(val) {
  if (!val || val === "all" || val === "All") return [];
  return String(val)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && s.toLowerCase() !== "all");
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
  const categories = parseCsvList(queryParams.category);
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

  // Deterministic cache key using only whitelisted catalog parameters
  const cacheKey = `catalog:list:${JSON.stringify({
    categories,
    seasons,
    colors,
    fabrics,
    sizes,
    minPrice,
    maxPrice,
    search,
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
  if (seasons.length > 0) match.season = { $in: seasons };
  if (colors.length > 0) match.color = { $in: colors };
  if (fabrics.length > 0) match.fabric = { $in: fabrics };
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