import { Review } from "../models/Review.js";
import { Product } from "../models/Product.js";
import { Order } from "../models/Order.js";
import { deleteImageKitFile } from "../config/imagekit.js";
import { logAdminAction } from "../utils/auditLogger.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { ApiError } from "../utils/apiError.js";

function formatReplyDTO(rep) {
  return {
    id: String(rep._id),
    parentReplyId: rep.parentReplyId ? String(rep.parentReplyId) : null,
    userId: String(rep.userId),
    authorName: rep.authorName,
    authorRole: rep.authorRole,
    comment: rep.comment,
    createdAt: rep.createdAt,
  };
}

function formatPublicReviewDTO(r) {
  return {
    id: String(r._id),
    userId: r.userId ? String(r.userId) : null,
    reviewerName: r.reviewerName,
    rating: r.rating,
    title: r.title,
    comment: r.comment,
    images: (r.images || []).map((img) => ({ url: img.url, fileId: img.fileId })),
    replies: (r.replies || []).map(formatReplyDTO),
    isVerifiedPurchase: r.isVerifiedPurchase,
    createdAt: r.createdAt,
  };
}

async function computeReviewEligibility(user, productId) {
  if (!user) {
    return { canReview: false, reason: "NOT_LOGGED_IN" };
  }
  if (user.role === "admin" || user.role === "super_admin") {
    return { canReview: false, reason: "ADMIN_DISABLED" };
  }

  const [alreadyReviewed, hasDeliveredOrder] = await Promise.all([
    Review.exists({ productId, userId: user._id }),
    Order.exists({
      userId: user._id,
      status: "DELIVERED",
      "items.productId": productId,
    }),
  ]);

  if (alreadyReviewed) {
    return { canReview: false, reason: "ALREADY_REVIEWED" };
  }
  if (!hasDeliveredOrder) {
    return { canReview: false, reason: "DELIVERY_REQUIRED" };
  }
  return { canReview: true, reason: "ELIGIBLE" };
}

export async function listProductReviews(req, res) {
  const slug = req.params.slug.toLowerCase();
  const product = await Product.findOne({ slug, isActive: true }).select("_id").lean();
  if (!product) {
    throw ApiError.notFound("Product not found");
  }

  const visibilityFilter = req.user?._id
    ? {
        productId: product._id,
        $or: [
          { status: "PUBLISHED" },
          { userId: req.user._id, status: "PENDING" },
        ],
      }
    : { productId: product._id, status: "PUBLISHED" };

  const [reviews, stats, eligibility] = await Promise.all([
    Review.find(visibilityFilter)
      .sort({ isVerifiedPurchase: -1, createdAt: -1 })
      .limit(50)
      .lean(),
    Review.aggregate([
      { $match: visibilityFilter },
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
    computeReviewEligibility(req.user, product._id),
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
      eligibility,
      summary: {
        averageRating: overall ? Number(overall.averageRating.toFixed(1)) : 0,
        totalReviews: overall ? overall.totalReviews : 0,
        breakdown: breakdownMap,
      },
      reviews: reviews.map(formatPublicReviewDTO),
    },
  });
}

export async function createProductReview(req, res) {
  if (req.user.role === "admin" || req.user.role === "super_admin") {
    throw ApiError.forbidden(
      "Admin accounts cannot post customer reviews on product pages. Use the Admin Panel to seed reviews."
    );
  }

  const slug = req.params.slug.toLowerCase();
  const product = await Product.findOne({ slug, isActive: true }).lean();
  if (!product) {
    throw ApiError.notFound("Product not found");
  }

  const hasDeliveredOrder = await Order.exists({
    userId: req.user._id,
    status: "DELIVERED",
    "items.productId": product._id,
  });

  if (!hasDeliveredOrder) {
    throw ApiError.forbidden(
      "Only customers who have purchased and received (Delivered) this piece can write a review."
    );
  }

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
    isVerifiedPurchase: true,
    status: "PENDING",
  });

  return sendSuccess(res, {
    statusCode: 201,
    data: { review: formatPublicReviewDTO(review) },
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

export async function addReviewReply(req, res) {
  const { comment, parentReplyId = null } = req.body;
  const review = await Review.findById(req.params.reviewId);
  if (!review) throw ApiError.notFound("Review not found");

  if (parentReplyId && !review.replies.id(parentReplyId)) {
    throw ApiError.badRequest("Parent reply not found");
  }

  const isAdmin = req.user.role === "admin" || req.user.role === "super_admin";
  const authorName = isAdmin
    ? "DIVARA Atelier"
    : req.user.fullName?.trim() || req.user.email.split("@")[0];

  review.replies.push({
    parentReplyId: parentReplyId || null,
    userId: req.user._id,
    authorName,
    authorRole: isAdmin ? "admin" : "user",
    comment,
  });

  await review.save();
  const created = review.replies[review.replies.length - 1];

  return sendSuccess(res, {
    statusCode: 201,
    message: "Reply posted.",
    data: { reply: formatReplyDTO(created) },
  });
}

export async function deleteReviewReply(req, res) {
  const review = await Review.findById(req.params.reviewId);
  if (!review) throw ApiError.notFound("Review not found");

  const reply = review.replies.id(req.params.replyId);
  if (!reply) throw ApiError.notFound("Reply not found");

  const isAdmin = req.user.role === "admin" || req.user.role === "super_admin";
  if (String(reply.userId) !== String(req.user._id) && !isAdmin) {
    throw ApiError.forbidden("You can only delete your own reply");
  }

  reply.deleteOne();
  await review.save();

  return sendSuccess(res, { message: "Reply deleted." });
}

export async function adminListReviews(req, res) {
  const status = req.query.status || "PENDING";
  const filter = status !== "ALL" ? { status } : {};

  const [reviews, pendingCount, publishedCount, hiddenCount] = await Promise.all([
    Review.find(filter)
      .populate("productId", "title slug imageMedia")
      .sort({ createdAt: -1 })
      .limit(150)
      .lean(),
    Review.countDocuments({ status: "PENDING" }),
    Review.countDocuments({ status: "PUBLISHED" }),
    Review.countDocuments({ status: "HIDDEN" }),
  ]);

  return sendSuccess(res, {
    data: {
      counts: { pending: pendingCount, published: publishedCount, hidden: hiddenCount },
      reviews: reviews.map((r) => ({
        id: String(r._id),
        productTitle: r.productId?.title || r.productSlug,
        productSlug: r.productSlug,
        productImage: r.productId?.imageMedia?.url || "",
        reviewerName: r.reviewerName,
        rating: r.rating,
        title: r.title,
        comment: r.comment,
        images: r.images || [],
        isVerifiedPurchase: r.isVerifiedPurchase,
        isSeeded: r.isSeeded,
        status: r.status,
        createdAt: r.createdAt,
      })),
    },
  });
}

export async function adminUpdateReviewStatus(req, res) {
  const { status } = req.body;
  const review = await Review.findByIdAndUpdate(
    req.params.reviewId,
    { $set: { status } },
    { returnDocument: "after" }
  );
  if (!review) throw ApiError.notFound("Review not found");

  await logAdminAction(req, {
    action: "REVIEW_MODERATED",
    targetType: "review",
    targetId: review._id,
    summary: `Set review "${review.title}" by ${review.reviewerName} to ${status}.`,
  });

  return sendSuccess(res, {
    message: `Review marked as ${status}.`,
    data: { id: String(review._id), status: review.status },
  });
}

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

  await logAdminAction(req, {
    action: "REVIEW_SEEDED",
    targetType: "product",
    targetId: product._id,
    summary: `Seeded ${inserted.length} review(s) for "${product.title}".`,
  });

  return sendSuccess(res, {
    statusCode: 201,
    message: `Seeded ${inserted.length} review(s) for ${product.title}.`,
    data: { count: inserted.length, reviews: inserted.map(formatPublicReviewDTO) },
  });
}

export async function adminDeleteReview(req, res) {
  const review = await Review.findById(req.params.reviewId);
  if (!review) throw ApiError.notFound("Review not found");

  await Promise.all((review.images || []).map((img) => deleteImageKitFile(img.fileId)));
  await Review.deleteOne({ _id: review._id });

  await logAdminAction(req, {
    action: "REVIEW_DELETED",
    targetType: "review",
    targetId: review._id,
    summary: `Deleted review "${review.title}" by ${review.reviewerName}.`,
  });

  return sendSuccess(res, { message: "Review removed by admin." });
}