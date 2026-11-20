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

/**
 * Single-stage MongoDB $facet aggregation powering /collections multi-facet filtering,
 * dual-thumb price slider, sorting, pagination, and live facet counts (zero Redis).
 */
export async function queryCatalog(queryParams) {
  const cacheKey = `catalog:list:${JSON.stringify(queryParams)}`;
  const cached = appCache.get(cacheKey);
  if (cached) return cached;

  const categories = parseCsvList(queryParams.category);
  const seasons = parseCsvList(queryParams.season);
  const colors = parseCsvList(queryParams.color);
  const fabrics = parseCsvList(queryParams.fabric);
  const sizes = parseCsvList(queryParams.size);
  const minPrice = Number(queryParams.minPrice) || 10000;
  const maxPrice = Number(queryParams.maxPrice) || 70000;
  const search = (queryParams.q || "").trim();
  const sort = queryParams.sort || "featured";
  const page = Math.max(1, Number(queryParams.page) || 1);
  const limit = Math.min(48, Math.max(1, Number(queryParams.limit) || 24));

  const match = {
    isActive: true,
    price: { $gte: minPrice, $lte: maxPrice },
  };

  if (categories.length > 0) match.category = { $in: categories };
  if (seasons.length > 0) match.season = { $in: seasons };
  if (colors.length > 0) match.color = { $in: colors };
  if (fabrics.length > 0) match.fabric = { $in: fabrics };
  if (sizes.length > 0) {
    match.variants = { $elemMatch: { size: { $in: sizes } } };
  }

  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rx = new RegExp(escaped, "i");
    match.$or = [
      { title: rx },
      { categoryLabel: rx },
      { season: rx },
      { fabric: rx },
      { color: rx },
    ];
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
      },
    },
  ]);

  const total = aggResult?.totalCount?.[0]?.total || 0;
  const items = (aggResult?.items || []).map((doc) => Product.toFrontendDTO(doc));

  const result = {
    items,
    facets: {
      categories: aggResult?.categories || [],
      seasons: aggResult?.seasons || [],
      colors: aggResult?.colors || [],
      fabrics: aggResult?.fabrics || [],
      priceBounds: { min: 10000, max: 70000 },
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
  const cacheKey = `catalog:slug:${slug}`;
  const cached = appCache.get(cacheKey);
  if (cached) return cached;

  const doc = await Product.findOne({ slug: slug.toLowerCase(), isActive: true }).lean();
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

  const cacheKey = `catalog:search:${clean.toLowerCase()}:${limit}`;
  const cached = appCache.get(cacheKey);
  if (cached) return cached;

  const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rx = new RegExp(escaped, "i");

  const filter = {
    isActive: true,
    $or: [
      { title: rx },
      { categoryLabel: rx },
      { season: rx },
      { fabric: rx },
      { color: rx },
    ],
  };

  const [docs, totalMatches] = await Promise.all([
    Product.find(filter).sort({ isFeatured: -1, sortOrder: 1 }).limit(limit).lean(),
    Product.countDocuments(filter),
  ]);

  const result = {
    matches: docs.map((d) => Product.toFrontendDTO(d)),
    totalMatches,
  };

  appCache.set(cacheKey, result, 180_000);
  return result;
}