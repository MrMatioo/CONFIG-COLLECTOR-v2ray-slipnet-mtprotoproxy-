import mongoose from "mongoose";

const supportSessionSchema = new mongoose.Schema({
  userId: { type: Number, required: true, unique: true },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

export const SupportSessionModel = mongoose.model(
  "SupportSession",
  supportSessionSchema,
);
