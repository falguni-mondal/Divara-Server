import { sendSuccess } from "../utils/apiResponse.js";
import {
  queryCatalog,
  getProductBySlug,
  getProductLiveStock,
  validateBulkStock,
  instantSearchCatalog,
} from "../services/catalog.service.js";

export async function listProducts(req, res) {
  const result = await queryCatalog(req.query);
  return sendSuccess(res, {
    data: { items: result.items, facets: result.facets },
    meta: result.meta,
  });
}

export async function getProductDetail(req, res) {
  const data = await getProductBySlug(req.params.slug);
  return sendSuccess(res, { data });
}

export async function getProductStock(req, res) {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  const data = await getProductLiveStock(req.params.slug);
  return sendSuccess(res, { data });
}

export async function validateStockBatch(req, res) {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  const data = await validateBulkStock(req.body.items);
  return sendSuccess(res, { data });
}

export async function searchProducts(req, res) {
  const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 8));
  const data = await instantSearchCatalog(req.query.q, limit);
  return sendSuccess(res, { data });
}