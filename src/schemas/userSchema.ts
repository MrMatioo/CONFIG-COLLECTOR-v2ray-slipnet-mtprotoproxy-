import { Schema, model } from "mongoose";

interface IUser {
  telegramId: number;
  username?: string;
  firstName: string;
  lastName?: string;
  phoneNumber?: string;
  isPremium: boolean;
  joinedAt: Date;
  lastActiveAt: Date;
  invitedBy?: number;
  // configsCount removed - not needed
}

const userSchema = new Schema<IUser>({
  telegramId: { type: Number, required: true, unique: true, index: true },
  username: { type: String, trim: true, lowercase: true, sparse: true },
  firstName: { type: String, required: true },
  lastName: { type: String, trim: true },
  phoneNumber: { type: String, sparse: true },
  isPremium: { type: Boolean, default: false },
  joinedAt: { type: Date, default: Date.now },
  lastActiveAt: { type: Date, default: Date.now },
  invitedBy: { type: Number, index: true },
});

export const UserModel = model<IUser>("User", userSchema);
