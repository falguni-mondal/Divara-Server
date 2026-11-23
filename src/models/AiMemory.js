import mongoose from "mongoose";

const VISITOR_TTL_DAYS = 90;
const MAX_ARRAY_ITEMS = 12;
const MAX_NOTES = 10;

// Hard blocklist preventing passwords, OTPs, card/UPI/ID numbers, or medical data from ever being saved
const BLOCKED_PATTERN =
  /\b(password|passcode|otp|cvv|cvc|upi\s*pin|card\s*number|aadhaar|aadhar|pan\s*card|passport|ssn|bank\s*account|ifsc|medical|disease|diagnosis|prescription|pregnant|surgery|admin)\b|\b\d{12,19}\b/i;

function cleanString(value, maxLen = 80) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, maxLen);
  if (!trimmed || BLOCKED_PATTERN.test(trimmed)) return null;
  return trimmed;
}

function cleanStringList(list, maxItems = MAX_ARRAY_ITEMS, maxLen = 40) {
  if (!Array.isArray(list)) return null;
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const cleaned = cleanString(item, maxLen);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(cleaned);
    }
    if (out.length >= maxItems) break;
  }
  return out;
}

function cleanMonthDay(obj) {
  if (!obj || typeof obj !== "object") return null;
  const month = Number(obj.month);
  const day = Number(obj.day);
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  return { month, day };
}

const monthDaySchema = new mongoose.Schema(
  {
    month: { type: Number, min: 1, max: 12 },
    day: { type: Number, min: 1, max: 31 },
  },
  { _id: false }
);

const aiMemorySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    deviceId: {
      type: String,
      trim: true,
      maxlength: 64,
      default: null,
    },
    preferredName: { type: String, trim: true, maxlength: 80, default: null },
    birthday: { type: monthDaySchema, default: null },
    anniversary: { type: monthDaySchema, default: null },
    preferredSize: { type: String, trim: true, maxlength: 24, default: null },
    preferredFit: { type: String, trim: true, maxlength: 32, default: null },
    styleLikes: { type: [String], default: [] },
    styleDislikes: { type: [String], default: [] },
    favoriteColors: { type: [String], default: [] },
    favoriteFabrics: { type: [String], default: [] },
    budgetMaxInr: { type: Number, min: 500, max: 5000000, default: null },
    upcomingOccasion: { type: String, trim: true, maxlength: 80, default: null },
    city: { type: String, trim: true, maxlength: 60, default: null },
    preferredPayment: { type: String, enum: ["razorpay", "cod", null], default: null },
    notes: { type: [String], default: [] },
    // Populated ONLY for anonymous visitor records (auto-expires after 90 days of inactivity)
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// MongoDB TTL index: deletes expired visitor records automatically; null expiresAt (customer) never expires
aiMemorySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
aiMemorySchema.index(
  { userId: 1 },
  { unique: true, partialFilterExpression: { userId: { $type: "objectId" } } }
);
aiMemorySchema.index(
  { deviceId: 1 },
  { unique: true, partialFilterExpression: { userId: null, deviceId: { $type: "string" } } }
);

export const AiMemory = mongoose.model("AiMemory", aiMemorySchema);

export function sanitizeMemoryPatch(raw = {}) {
  const patch = {};

  const preferredName = cleanString(raw.preferredName, 80);
  if (preferredName) patch.preferredName = preferredName;

  const birthday = cleanMonthDay(raw.birthday);
  if (birthday) patch.birthday = birthday;

  const anniversary = cleanMonthDay(raw.anniversary);
  if (anniversary) patch.anniversary = anniversary;

  const preferredSize = cleanString(raw.preferredSize, 24);
  if (preferredSize) patch.preferredSize = preferredSize;

  const preferredFit = cleanString(raw.preferredFit, 32);
  if (preferredFit) patch.preferredFit = preferredFit;

  const upcomingOccasion = cleanString(raw.upcomingOccasion, 80);
  if (upcomingOccasion) patch.upcomingOccasion = upcomingOccasion;

  const city = cleanString(raw.city, 60);
  if (city) patch.city = city;

  if (raw.preferredPayment === "cod" || raw.preferredPayment === "razorpay") {
    patch.preferredPayment = raw.preferredPayment;
  }

  if (raw.budgetMaxInr !== undefined && raw.budgetMaxInr !== null) {
    const budget = Math.round(Number(raw.budgetMaxInr));
    if (Number.isFinite(budget) && budget >= 500 && budget <= 5000000) {
      patch.budgetMaxInr = budget;
    }
  }

  const arrays = {};
  for (const field of ["styleLikes", "styleDislikes", "favoriteColors", "favoriteFabrics"]) {
    const list = cleanStringList(raw[field], MAX_ARRAY_ITEMS, 40);
    if (list && list.length > 0) arrays[field] = list;
  }

  const notes = cleanStringList(raw.notes, MAX_NOTES, 120);
  if (notes && notes.length > 0) arrays.notes = notes;

  return { patch, arrays };
}

export function getVisitorExpiryDate() {
  return new Date(Date.now() + VISITOR_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export function formatMemoryForPrompt(doc) {
  if (!doc) return "None saved yet.";
  const parts = [];
  if (doc.preferredName) parts.push(`Name: ${doc.preferredName}`);
  if (doc.birthday?.month && doc.birthday?.day) {
    parts.push(
      `Birthday: ${String(doc.birthday.day).padStart(2, "0")}/${String(doc.birthday.month).padStart(2, "0")}`
    );
  }
  if (doc.anniversary?.month && doc.anniversary?.day) {
    parts.push(
      `Anniversary: ${String(doc.anniversary.day).padStart(2, "0")}/${String(doc.anniversary.month).padStart(2, "0")}`
    );
  }
  if (doc.preferredSize) parts.push(`Size: ${doc.preferredSize}`);
  if (doc.preferredFit) parts.push(`Fit: ${doc.preferredFit}`);
  if (doc.favoriteColors?.length) parts.push(`Favorite colors: ${doc.favoriteColors.join(", ")}`);
  if (doc.favoriteFabrics?.length) parts.push(`Favorite fabrics: ${doc.favoriteFabrics.join(", ")}`);
  if (doc.styleLikes?.length) parts.push(`Likes: ${doc.styleLikes.join(", ")}`);
  if (doc.styleDislikes?.length) parts.push(`Dislikes: ${doc.styleDislikes.join(", ")}`);
  if (doc.budgetMaxInr) parts.push(`Budget ceiling: INR ${doc.budgetMaxInr}`);
  if (doc.upcomingOccasion) parts.push(`Occasion: ${doc.upcomingOccasion}`);
  if (doc.city) parts.push(`City: ${doc.city}`);
  if (doc.preferredPayment) {
    parts.push(
      `Payment preference: ${doc.preferredPayment === "cod" ? "Cash on Delivery" : "Online Payment"}`
    );
  }
  if (doc.notes?.length) parts.push(`Notes: ${doc.notes.join("; ")}`);
  return parts.length ? parts.join(" | ") : "None saved yet.";
}

export async function mergeVisitorMemoryToUser(deviceId, userId) {
  if (!deviceId || !userId) return;
  const visitorDoc = await AiMemory.findOne({ userId: null, deviceId }).lean();
  if (!visitorDoc) return;

  const existingUserDoc = await AiMemory.findOne({ userId });
  if (!existingUserDoc) {
    await AiMemory.updateOne(
      { _id: visitorDoc._id },
      { $set: { userId, expiresAt: null } }
    );
    return;
  }

  const scalarFields = [
    "preferredName",
    "birthday",
    "anniversary",
    "preferredSize",
    "preferredFit",
    "budgetMaxInr",
    "upcomingOccasion",
    "city",
    "preferredPayment",
  ];
  for (const field of scalarFields) {
    if (!existingUserDoc[field] && visitorDoc[field]) {
      existingUserDoc[field] = visitorDoc[field];
    }
  }

  const arrayFields = ["styleLikes", "styleDislikes", "favoriteColors", "favoriteFabrics", "notes"];
  for (const field of arrayFields) {
    const merged = cleanStringList(
      [...(existingUserDoc[field] || []), ...(visitorDoc[field] || [])],
      field === "notes" ? MAX_NOTES : MAX_ARRAY_ITEMS,
      field === "notes" ? 120 : 40
    );
    if (merged) existingUserDoc[field] = merged;
  }

  existingUserDoc.expiresAt = null;
  await existingUserDoc.save();
  await AiMemory.deleteOne({ _id: visitorDoc._id });
}