import mongoose from "mongoose";

const ticketReplySchema = new mongoose.Schema(
  {
    // Null = direct reply to the ticket; ObjectId = nested reply-to-reply
    parentReplyId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    authorRole: {
      type: String,
      enum: ["admin", "user"],
      required: true,
    },
    authorName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    authorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 3000,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true }
);

const supportTicketSchema = new mongoose.Schema(
  {
    ticketNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 4000,
    },
    assignedBoutique: {
      type: String,
      enum: ["Kolkata", "Mumbai", "New Delhi"],
      default: "Kolkata",
    },
    status: {
      type: String,
      enum: ["OPEN", "IN_PROGRESS", "RESOLVED"],
      default: "OPEN",
      index: true,
    },
    replies: {
      type: [ticketReplySchema],
      default: [],
    },
    adminNotes: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

supportTicketSchema.index({ status: 1, createdAt: -1 });
supportTicketSchema.index({ email: 1, createdAt: -1 });

export const SupportTicket = mongoose.model("SupportTicket", supportTicketSchema);