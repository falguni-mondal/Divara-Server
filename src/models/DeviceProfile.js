import mongoose from "mongoose";

const tier1SignalsSchema = new mongoose.Schema(
  {
    webglVendor: { type: String, default: "unsupported", maxlength: 160 },
    webglRenderer: { type: String, default: "unsupported", maxlength: 220 },
    canvasHash: { type: String, default: "unsupported", maxlength: 80 },
    audioHash: { type: String, default: "unsupported", maxlength: 80 },
    cpuCores: { type: Number, default: 0 },
    deviceMemory: { type: Number, default: 0 },
    maxTouchPoints: { type: Number, default: 0 },
    osPlatform: { type: String, default: "unknown", maxlength: 80 },
    timezone: { type: String, default: "unknown", maxlength: 80 },
    primaryLanguage: { type: String, default: "unknown", maxlength: 40 },
    // 4 Bonus Stable Hardware Signals (zero popups, zero lag)
    webglLimitsHash: { type: String, default: "unsupported", maxlength: 80 },
    webgpuHash: { type: String, default: "unsupported", maxlength: 80 },
    mediaCodecsHash: { type: String, default: "unsupported", maxlength: 80 },
    mathHash: { type: String, default: "unsupported", maxlength: 80 },
  },
  { _id: false }
);

const deviceProfileSchema = new mongoose.Schema(
  {
    deviceId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
      maxlength: 64,
    },
    visitorCode: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
      maxlength: 24,
    },
    primaryHash: {
      type: String,
      required: true,
      index: true,
      maxlength: 80,
    },
    knownHashes: {
      type: [String],
      default: [],
      index: true,
    },
    signals: {
      type: tier1SignalsSchema,
      default: () => ({}),
    },
    deviceType: {
      type: String,
      enum: ["mobile", "tablet", "desktop"],
      default: "desktop",
    },
    browserFamily: {
      type: String,
      default: "Unknown",
      maxlength: 60,
    },
    isHighCollisionHardware: {
      type: Boolean,
      default: false,
      index: true,
    },
    linkedUserIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    lastActiveSessionId: {
      type: String,
      default: "",
      maxlength: 80,
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
    },
    firstSeenAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// Auto-expire inactive device profiles after 180 days (MongoDB TTL)
deviceProfileSchema.index(
  { lastSeenAt: 1 },
  { expireAfterSeconds: 180 * 24 * 60 * 60 }
);

// Compound index for Layer 2 drift-recovery anchor queries
deviceProfileSchema.index({
  "signals.osPlatform": 1,
  "signals.timezone": 1,
  "signals.webglRenderer": 1,
});

export const DeviceProfile = mongoose.model("DeviceProfile", deviceProfileSchema);