import { PolicyPage } from "../models/PolicyPage.js";
import { appCache } from "../utils/lruCache.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { ApiError } from "../utils/apiError.js";

export async function listPolicies(_req, res) {
  const cacheKey = "policies:list";
  const cached = appCache.get(cacheKey);
  if (cached) return sendSuccess(res, { data: { policies: cached } });

  const policies = await PolicyPage.find({ isPublished: true })
    .select("slug title summary effectiveDate updatedAt")
    .sort({ slug: 1 })
    .lean();

  appCache.set(cacheKey, policies, 300_000);
  return sendSuccess(res, { data: { policies } });
}

export async function getPolicyBySlug(req, res) {
  const slug = req.params.slug.toLowerCase();
  const cacheKey = `policies:slug:${slug}`;
  const cached = appCache.get(cacheKey);
  if (cached) return sendSuccess(res, { data: { policy: cached } });

  const policy = await PolicyPage.findOne({ slug, isPublished: true }).lean();
  if (!policy) {
    throw ApiError.notFound("Policy document not found");
  }

  appCache.set(cacheKey, policy, 300_000);
  return sendSuccess(res, { data: { policy } });
}