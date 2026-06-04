import { UserModel } from "../schemas/userSchema.js";
import logger from "../utils/logger.js";

export async function saveUserToDB(user: any, updateLastActive = false) {
  const updateData: any = {
    username: user.username,
    firstName: user.first_name,
    lastName: user.last_name,
    isPremium: user.is_premium || false,
  };
  if (updateLastActive) {
    updateData.lastActiveAt = new Date();
  }
  try {
    await UserModel.findOneAndUpdate(
      { telegramId: user.id },
      {
        $set: updateData,
        $setOnInsert: { joinedAt: new Date() },
      },
      { upsert: true },
    );
  } catch (err: any) {
    logger.error(`Failed to save user ${user.id}: ${err.message}`);
    setTimeout(async () => {
      try {
        await UserModel.findOneAndUpdate(
          { telegramId: user.id },
          {
            $set: updateData,
            $setOnInsert: { joinedAt: new Date() },
          },
          { upsert: true },
        );
      } catch (retryErr: any) {
        logger.error(`Retry failed for user ${user.id}: ${retryErr.message}`);
      }
    }, 2000);
  }
}

export async function updateLastActive(userId: number) {
  await UserModel.updateOne(
    { telegramId: userId },
    { $set: { lastActiveAt: new Date() } },
  ).catch((err) =>
    logger.error(`Failed to update lastActive for ${userId}: ${err.message}`),
  );
}
