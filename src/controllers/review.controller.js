import { Review } from "../models/Review.js";
import { Product } from "../models/Product.js";
import { Order } from "../models/Order.js";
import { deleteImageKitFile } from "../config/imagekit.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { ApiError } from "../utils/apiError.js";

export async function listProductReviews(req, res) {
  const slug = req.params.slug.toLowerCase();
  const product = await Product.findOne({ slug, isActive: true }).select("_id").lean();
  if (!product) {
    throw ApiError.notFound("Product not found");
  }

  const [reviews, stats] = await Promise.all([
    Review.find({ productId: product._id, status: "PUBLISHED" })
      .sort({ isVerifiedPurchase: -1, createdAt: -1 })
      .limit(50)
      .lean(),
    Review.aggregate([
      { $match: { productId: product._id, status: "PUBLISHED" } },
      {
        $facet: {
          overall: [
            {
              $group: {
                _id: null,
                averageRating: { $avg: "$rating" },
                totalReviews: { $sum: 1 },
              },
            },
          ],
          breakdown: [{ $sortByCount: "$rating" }],
        },
      },
    ]),
  ]);

  const overall = stats[0]?.overall?.[0];
  const breakdownMap = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  for (const row of stats[0]?.breakdown || []) {
    if (breakdownMap[row._id] !== undefined) {
      breakdownMap[row._id] = row.count;
    }
  }

  return sendSuccess(res, {
    data: {
      summary: {
        averageRating: overall ? Number(overall.averageRating.toFixed(1)) : 0,
        totalReviews: overall ? overall.totalReviews : 0,
        breakdown: breakdownMap,
      },
      reviews: reviews.map((r) => ({
        id: String(r._id),
        userId: r.userId ? String(r.userId) : null,
        reviewerName: r.reviewerName,
        rating: r.rating,
        title: r.title,
        comment: r.comment,
        images: (r.images || []).map((img) => ({ url: img.url, fileId: img.fileId })),
        isVerifiedPurchase: r.isVerifiedPurchase,
        createdAt: r.createdAt,
      })),
    },
  });
}

export async function createProductReview(req, res) {
  const slug = req.params.slug.toLowerCase();
  const product = await Product.findOne({ slug, isActive: true }).lean();
  if (!product) {
    throw ApiError.notFound("Product not found");
  }

  const hasPaidOrder = await Order.exists({
    userId: req.user._id,
    status: { $in: ["PAID", "PROCESSING", "SHIPPED", "DELIVERED"] },
    "items.productId": product._id,
  });

  const reviewerName = req.user.fullName?.trim() || req.user.email.split("@")[0];

  const review = await Review.create({
    productId: product._id,
    productSlug: product.slug,
    userId: req.user._id,
    isSeeded: false,
    reviewerName,
    rating: req.body.rating,
    title: req.body.title,
    comment: req.body.comment,
    images: (req.body.images || []).slice(0, 3),
    isVerifiedPurchase: Boolean(hasPaidOrder),
  });

  return sendSuccess(res, {
    statusCode: 201,
    message: "Thank you for sharing your review.",
    data: {
      review: {
        id: String(review._id),
        userId: String(review.userId),
        reviewerName: review.reviewerName,
        rating: review.rating,
        title: review.title,
        comment: review.comment,
        images: review.images,
        isVerifiedPurchase: review.isVerifiedPurchase,
        createdAt: review.createdAt,
      },
    },
  });
}

export async function deleteMyReview(req, res) {
  const review = await Review.findOne({
    _id: req.params.reviewId,
    userId: req.user._id,
  });

  if (!review) {
    throw ApiError.notFound("Review not found");
  }

  await Promise.all((review.images || []).map((img) => deleteImageKitFile(img.fileId)));
  await Review.deleteOne({ _id: review._id });

  return sendSuccess(res, { message: "Your review has been deleted" });
}

/**
 * Admin Panel Review Seeding (single or bulk reviews with optional backdated createdAt & up to 3 ImageKit photos).
 */
export async function adminSeedReviews(req, res) {
  const { productSlug, reviews } = req.body;
  const product = await Product.findOne({ slug: productSlug.toLowerCase() }).lean();
  if (!product) {
    throw ApiError.notFound(`Product "${productSlug}" not found`);
  }

  const docs = reviews.map((r) => ({
    productId: product._id,
    productSlug: product.slug,
    userId: null,
    isSeeded: true,
    reviewerName: r.reviewerName,
    rating: r.rating,
    title: r.title,
    comment: r.comment,
    images: (r.images || []).slice(0, 3),
    isVerifiedPurchase: r.isVerifiedPurchase ?? true,
    status: "PUBLISHED",
    ...(r.createdAt ? { createdAt: new Date(r.createdAt) } : {}),
  }));

  const inserted = await Review.insertMany(docs);

  return sendSuccess(res, {
    statusCode: 201,
    message: `Seeded ${inserted.length} review(s) for ${product.title}.`,
    data: { count: inserted.length, reviews: inserted },
  });
}

export async function adminDeleteReview(req, res) {
  const review = await Review.findById(req.params.reviewId);
  if (!review) throw ApiError.notFound("Review not found");

  await Promise.all((review.images || []).map((img) => deleteImageKitFile(img.fileId)));
  await Review.deleteOne({ _id: review._id });

  return sendSuccess(res, { message: "Review removed by admin." });
}