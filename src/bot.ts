import { Bot, InlineKeyboard, InputFile } from "grammy";
import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import { UserModel } from "./schemas/userSchema.js";
import { collector } from "./utils/collector.js";
import { getTelegramClient } from "./client.js";
import { setupAdminPanel, setUserMenuKeyboard } from "./admin.js";
import * as dotenv from "dotenv";
dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("BOT_TOKEN is not set in environment variables.");
  process.exit(1);
}

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/config_bot";
const REQUIRED_CHANNEL = process.env.REQUIRED_CHANNEL || "@configCollectore";
const ADMIN_ID = Number(process.env.ADMIN_ID) || 0;
const STICKER_FILE_ID = process.env.STICKER_FILE_ID || "";

if (ADMIN_ID === 0) {
  console.warn(
    "ADMIN_ID not set, manual update command and support forwarding will not work.",
  );
}

const bot = new Bot(BOT_TOKEN);
bot.catch((err) => console.error("Bot general error:", err));

async function sendLongText(ctx: any, text: string) {
  const MAX_LEN = 4096;
  if (text.length <= MAX_LEN) {
    await ctx.reply(text, { parse_mode: "HTML" });
  } else {
    for (let i = 0; i < text.length; i += MAX_LEN) {
      await ctx.reply(text.slice(i, i + MAX_LEN), { parse_mode: "HTML" });
    }
  }
}

async function sendTempMessage(ctx: any): Promise<number | null> {
  if (STICKER_FILE_ID) {
    try {
      const stickerMsg = await ctx.replyWithSticker(STICKER_FILE_ID);
      return stickerMsg.message_id;
    } catch {
      const tempMsg = await ctx.reply("در حال پردازش...");
      return tempMsg.message_id;
    }
  } else {
    const tempMsg = await ctx.reply("در حال پردازش...");
    return tempMsg.message_id;
  }
}

async function deleteMessage(ctx: any, messageId: number) {
  try {
    await ctx.api.deleteMessage(ctx.chat.id, messageId);
  } catch (error) {
    console.error("Failed to delete temp message:", error);
  }
}

const channelLinkKeyboard = new InlineKeyboard().url(
  "عضویت در کانال",
  `https://t.me/${REQUIRED_CHANNEL.replace("@", "")}`,
);

const mainMenuKeyboard = new InlineKeyboard()
  .text("دریافت کانفیگ v2ray", "getV2ray")
  .row()
  .text("دریافت کانفیگ slipnet", "getSlipnet")
  .row()
  .text("دریافت پروکسی", "getProxy")
  .row()
  .text("راهنما", "help")
  .text("کانال ما", "channel")
  .row()
  .text("پشتیبانی", "support");

setUserMenuKeyboard(mainMenuKeyboard);

async function saveUserToDB(user: any) {
  try {
    await UserModel.findOneAndUpdate(
      { telegramId: user.id },
      {
        $set: {
          username: user.username,
          firstName: user.first_name,
          lastName: user.last_name,
          isPremium: user.is_premium || false,
          lastActiveAt: new Date(),
        },
        $setOnInsert: { joinedAt: new Date() },
      },
      { upsert: true },
    );
    console.log(`User ${user.id} saved/updated`);
  } catch (err) {
    console.error(`Failed to save user ${user.id}:`, err);
    setTimeout(async () => {
      try {
        await UserModel.findOneAndUpdate(
          { telegramId: user.id },
          {
            $set: {
              username: user.username,
              firstName: user.first_name,
              lastName: user.last_name,
              isPremium: user.is_premium || false,
              lastActiveAt: new Date(),
            },
            $setOnInsert: { joinedAt: new Date() },
          },
          { upsert: true },
        );
        console.log(`User ${user.id} saved on retry`);
      } catch (retryErr) {
        console.error(`Retry failed for user ${user.id}:`, retryErr);
      }
    }, 2000);
  }
}

let supportMode = new Set<number>();
let adminReplyMode = new Map<number, number>();

bot.command("start", async (ctx) => {
  if (ctx.chat?.type !== "private") {
    await ctx.reply("لطفاً برای استفاده از ربات، به چت خصوصی من مراجعه کنید.");
    return;
  }
  const user = ctx.from;
  if (!user) return ctx.reply("اطلاعات کاربر یافت نشد.");

  supportMode.delete(user.id);
  adminReplyMode.delete(user.id);
  await ctx.reply(`<b>سلام</b> ${user.first_name} عزیز!`, {
    parse_mode: "HTML",
  });

  try {
    const chatMember = await ctx.api.getChatMember(REQUIRED_CHANNEL, user.id);
    const isMember = !(
      chatMember.status === "left" || chatMember.status === "kicked"
    );

    if (!isMember) {
      await ctx.reply(
        `<b>دسترسی غیرفعال!</b>\n\nبرای استفاده از ربات باید در کانال ما عضو باشید.\n\nلطفاً روی دکمه زیر کلیک کرده و پس از عضویت، مجدداً /start را ارسال کنید.`,
        { reply_markup: channelLinkKeyboard, parse_mode: "HTML" },
      );
      return;
    }

    if (user.id === ADMIN_ID) {
      const adminKeyboard = new InlineKeyboard()
        .text("📊 آمار کاربران", "admin_stats")
        .row()
        .text("📢 ارسال همگانی", "admin_broadcast")
        .row()
        .text("👥 لیست کاربران", "admin_users_list")
        .row()
        .text("⚙️ تنظیمات", "admin_settings")
        .row()
        .text("👤 پنل کاربری", "go_to_user_panel")
        .row()
        .text("🔙 بستن منو", "admin_close");
      await ctx.reply("🔐 پنل مدیریت", {
        reply_markup: adminKeyboard,
        parse_mode: "HTML",
      });
    } else {
      await ctx.reply(
        `<b>به ربات خوش آمدید!</b>\n\nاز دکمه‌های زیر می‌توانید کانفیگ‌های مورد نظر خود را دریافت کنید.`,
        { reply_markup: mainMenuKeyboard, parse_mode: "HTML" },
      );
    }

    saveUserToDB(user).catch(console.error);
  } catch (error) {
    console.error("Error checking membership:", error);
    await ctx.reply("خطا در بررسی عضویت. لطفاً بعداً تلاش کنید.");
  }
});

bot.command("update", async (ctx) => {
  if (ctx.chat?.type !== "private") return;
  if (ctx.from?.id !== ADMIN_ID)
    return ctx.reply("شما مجاز به اجرای این دستور نیستید.");
  await ctx.reply("در حال به‌روزرسانی کانفیگ‌ها، لطفاً صبر کنید...");
  await updateConfigs();
  await ctx.reply("کانفیگ‌ها با موفقیت به‌روزرسانی شدند.");
});

async function sendConfigFile(ctx: any, filePath: string, configName: string) {
  const header = `<b>${configName}</b>\nایدی ربات: ${process.env.BOT_USERNAME || "@unknown_bot"}\n\nبرگشت به پنل: /start`;
  if (fs.existsSync(filePath)) {
    await ctx.replyWithDocument(new InputFile(filePath), {
      caption: header,
      parse_mode: "HTML",
    });
  } else {
    await ctx.reply(
      `<b>فایل کانفیگ ${configName} یافت نشد.</b> لطفاً بعداً تلاش کنید.`,
      { parse_mode: "HTML" },
    );
  }
}

async function sendProxyText(ctx: any, filePath: string) {
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, "utf-8");
    if (!content.trim()) {
      await ctx.reply("<b>پروکسی در حال حاضر موجود نیست.</b>", {
        parse_mode: "HTML",
      });
      return;
    }
    const header = `<b>پروکسی</b>\nایدی ربات: ${process.env.BOT_USERNAME || "@unknown_bot"}\n\nبرگشت به پنل: /start\n\n`;
    await sendLongText(ctx, header + content);
  } else {
    await ctx.reply("<b>فایل پروکسی یافت نشد.</b> لطفاً بعداً تلاش کنید.", {
      parse_mode: "HTML",
    });
  }
}

async function withTempMessage(ctx: any, action: () => Promise<void>) {
  const tempMsgId = await sendTempMessage(ctx);
  try {
    await action();
  } finally {
    if (tempMsgId) await deleteMessage(ctx, tempMsgId);
  }
}

bot.callbackQuery("getV2ray", async (ctx) => {
  await ctx.answerCallbackQuery();
  await withTempMessage(ctx, async () => {
    const filePath = path.resolve("./v2ray_configs.txt");
    await sendConfigFile(ctx, filePath, "v2ray");
  });
});

bot.callbackQuery("getSlipnet", async (ctx) => {
  await ctx.answerCallbackQuery();
  await withTempMessage(ctx, async () => {
    const filePath = path.resolve("./slipnet_configs.txt");
    await sendConfigFile(ctx, filePath, "slipnet");
  });
});

bot.callbackQuery("getProxy", async (ctx) => {
  await ctx.answerCallbackQuery();
  await withTempMessage(ctx, async () => {
    const filePath = path.resolve("./proxy.txt");
    await sendProxyText(ctx, filePath);
  });
});

bot.callbackQuery("help", async (ctx) => {
  await ctx.answerCallbackQuery();
  await withTempMessage(ctx, async () => {
    await ctx.reply(
      `<b>راهنما</b>\n\n- پس از عضویت در کانال ${REQUIRED_CHANNEL} می‌توانید از دکمه‌های زیر استفاده کنید.\n- کانفیگ‌های <b>v2ray</b> و <b>slipnet</b> به صورت فایل ارسال می‌شوند.\n- <b>پروکسی</b> به صورت متن ارسال می‌گردد.\n- کانفیگ‌ها هر یک ساعت یکبار به‌روز می‌شوند.\n- برای پشتیبانی از دکمه «پشتیبانی» استفاده کنید.\n\nبرگشت به پنل: /start`,
      { parse_mode: "HTML" },
    );
  });
});

bot.callbackQuery("channel", async (ctx) => {
  await ctx.answerCallbackQuery();
  await withTempMessage(ctx, async () => {
    await ctx.reply(
      `<b>کانال ما</b>\n\nبرای عضویت و اطلاع از آخرین کانفیگ‌ها، به کانال زیر بپیوندید:\n${REQUIRED_CHANNEL}`,
      { reply_markup: channelLinkKeyboard, parse_mode: "HTML" },
    );
  });
});

bot.callbackQuery("support", async (ctx) => {
  await ctx.answerCallbackQuery();
  await withTempMessage(ctx, async () => {
    const userId = ctx.from.id;
    supportMode.add(userId);
    await ctx.reply(
      `<b>حالت پشتیبانی</b>\n\nشما در حالت ارتباط با پشتیبانی قرار گرفتید.\n\nلطفاً پیام خود را ارسال کنید. پیام شما مستقیماً برای ادمین ارسال خواهد شد.\n\n(برای خروج از این حالت، کافیست دستور /start را وارد کنید.)`,
      { parse_mode: "HTML" },
    );
  });
});

bot.on("message:text", async (ctx) => {
  if (ctx.chat?.type !== "private") return;

  const userId = ctx.from.id;

  // Admin reply mode
  if (adminReplyMode.has(userId)) {
    const targetUserId = adminReplyMode.get(userId)!;
    const replyText = ctx.message.text;
    try {
      await bot.api.sendMessage(
        targetUserId,
        `<b>پاسخ ادمین:</b>\n\n${replyText}`,
        { parse_mode: "HTML" },
      );
      await ctx.reply("✅ پاسخ شما با موفقیت به کاربر ارسال شد.");
    } catch (error) {
      console.error("Failed to send reply:", error);
      await ctx.reply(
        "❌ خطا در ارسال پاسخ. ممکن است کاربر ربات را بلاک کرده باشد.",
      );
    }
    adminReplyMode.delete(userId);
    return;
  }

  // Support mode
  if (supportMode.has(userId)) {
    const userMessage = ctx.message.text;
    const userInfo = ctx.from;
    const forwardText = `<b>پیام جدید از کاربر</b>\n\nنام: ${userInfo.first_name} ${userInfo.last_name || ""}\nآیدی: <code>${userInfo.id}</code>\nنام کاربری: @${userInfo.username || "ندارد"}\n\nمتن پیام:\n${userMessage}`;
    const replyKeyboard = new InlineKeyboard().text(
      "📝 پاسخ به کاربر",
      `reply_to_${userInfo.id}`,
    );

    try {
      if (ADMIN_ID !== 0) {
        await bot.api.sendMessage(ADMIN_ID, forwardText, {
          parse_mode: "HTML",
          reply_markup: replyKeyboard,
        });
        await ctx.reply(
          "<b>پیام شما با موفقیت به پشتیبانی ارسال شد.</b> در اسرع وقت پاسخ داده می‌شود.",
          { parse_mode: "HTML" },
        );
      } else {
        await ctx.reply("<b>سیستم پشتیبانی در حال حاضر فعال نیست.</b>", {
          parse_mode: "HTML",
        });
      }
    } catch (error) {
      console.error("Failed to forward support message:", error);
      await ctx.reply("<b>خطا در ارسال پیام.</b> لطفاً بعداً تلاش کنید.", {
        parse_mode: "HTML",
      });
    }
    supportMode.delete(userId);
    return;
  }

  // Default menu prompt for admin or user
  if (userId === ADMIN_ID) {
    const adminKeyboard = new InlineKeyboard()
      .text("📊 آمار کاربران", "admin_stats")
      .row()
      .text("📢 ارسال همگانی", "admin_broadcast")
      .row()
      .text("👥 لیست کاربران", "admin_users_list")
      .row()
      .text("⚙️ تنظیمات", "admin_settings")
      .row()
      .text("👤 پنل کاربری", "go_to_user_panel")
      .row()
      .text("🔙 بستن منو", "admin_close");
    await ctx.reply(
      "لطفاً از دکمه‌های منوی زیر استفاده کنید یا دستور /start را وارد نمایید.",
      { reply_markup: adminKeyboard, parse_mode: "HTML" },
    );
  } else {
    await ctx.reply(
      "لطفاً از دکمه‌های منوی زیر استفاده کنید یا دستور /start را وارد نمایید.",
      { reply_markup: mainMenuKeyboard, parse_mode: "HTML" },
    );
  }
});

// Callback for reply button
bot.callbackQuery(/reply_to_(\d+)/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (ctx.from.id !== ADMIN_ID) {
    await ctx.reply("شما مجاز به پاسخگویی نیستید.");
    return;
  }
  const match = ctx.match[1];
  if (!match) {
    await ctx.reply("خطا در شناسایی کاربر.");
    return;
  }
  const targetUserId = parseInt(match, 10);
  adminReplyMode.set(ADMIN_ID, targetUserId);
  await ctx.reply(
    "✏️ لطفاً پاسخ خود را به صورت متن ارسال کنید. (می‌تواند شامل HTML باشد)",
  );
});

let telegramClient: any = null;

async function updateConfigs() {
  if (!telegramClient) return;
  console.log("Collecting configs...");
  await collector(telegramClient);
  console.log("Collection finished.");
}

async function dropConflictingIndex() {
  try {
    const collection = mongoose.connection.collection("users");
    const indexes = await collection.indexes();
    const idIndex = indexes.find((idx) => idx.name === "id_1");
    if (idIndex) {
      await collection.dropIndex("id_1");
      console.log("Dropped old index 'id_1' from users collection.");
    }
  } catch (err) {
    console.warn("Could not drop index 'id_1':", err);
  }
}

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log("Database connected.");

  await dropConflictingIndex();

  setupAdminPanel(bot);

  getTelegramClient()
    .then((client) => {
      telegramClient = client;
      updateConfigs();
      setInterval(updateConfigs, 60 * 60 * 1000);
    })
    .catch(console.error);

  bot.start();
  console.log("Bot started successfully.");
}

main().catch(console.error);
