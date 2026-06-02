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

const MONGODB_URI = process.env.MONGODB_URI;
const REQUIRED_CHANNEL = process.env.REQUIRED_CHANNEL || "@configCollectore";
const ADMIN_ID = Number(process.env.ADMIN_ID) || 0;
const STICKER_FILE_ID = process.env.STICKER_FILE_ID || "";
const START_TIME = Date.now();

if (ADMIN_ID === 0) {
  console.warn(
    "ADMIN_ID not set, manual update command and support forwarding will not work.",
  );
}

const bot = new Bot(BOT_TOKEN);
bot.catch((err: any) => {
  console.error("Bot Error:", err.message || err);
});

async function sendLongText(ctx: any, text: string) {
  const MAX_LEN = 4096;
  if (text.length <= MAX_LEN) {
    await ctx.reply(text);
  } else {
    for (let i = 0; i < text.length; i += MAX_LEN) {
      await ctx.reply(text.slice(i, i + MAX_LEN));
    }
  }
}

async function sendTempMessage(ctx: any): Promise<number | null> {
  if (STICKER_FILE_ID) {
    try {
      const stickerMsg = await ctx.replyWithSticker(STICKER_FILE_ID);
      return stickerMsg.message_id;
    } catch {
      const tempMsg = await ctx.reply(
        "⏳ <b>لطفاً چند لحظه صبر کنید...</b>\nدر حال پردازش درخواست شما هستیم.",
        { parse_mode: "HTML" },
      );
      return tempMsg.message_id;
    }
  } else {
    const tempMsg = await ctx.reply(
      "⏳ <b>لطفاً چند لحظه صبر کنید...</b>\nدر حال پردازش درخواست شما هستیم.",
      { parse_mode: "HTML" },
    );
    return tempMsg.message_id;
  }
}

async function deleteMessage(ctx: any, messageId: number) {
  try {
    await ctx.api.deleteMessage(ctx.chat.id, messageId);
  } catch (error: any) {
    console.error("Failed to delete temp message:", error.message || error);
  }
}

const channelLinkKeyboard = new InlineKeyboard().url(
  "📢 عضویت فوری در کانال",
  `https://t.me/${REQUIRED_CHANNEL.replace("@", "")}`,
);

const mainMenuKeyboard = new InlineKeyboard()
  .text("🚀 دریافت کانفیگ v2ray", "getV2ray")
  .row()
  .text("🛡️ دریافت کانفیگ slipnet", "getSlipnet")
  .row()
  .text("🔗 دریافت پروکسی تلگرام", "getProxy")
  .row()
  .text("❓ راهنما", "help")
  .text("🆔 کانال ما", "channel")
  .row()
  .text("🎧 پشتیبانی آنلاین", "support");

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
  } catch (err: any) {
    console.error(`Failed to save user ${user.id}:`, err.message || err);
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
      } catch (retryErr: any) {
        console.error(
          `Retry failed for user ${user.id}:`,
          retryErr.message || retryErr,
        );
      }
    }, 2000);
  }
}

let supportMode = new Set<number>();
let adminReplyMode = new Map<number, number>();

bot.command("start", async (ctx) => {
  if (ctx.chat?.type !== "private") {
    await ctx.reply(
      "❌ <b>دسترسی محدود!</b>\nلطفاً برای استفاده از امکانات ربات، به چت خصوصی من مراجعه کنید.",
      { parse_mode: "HTML" },
    );
    return;
  }
  const user = ctx.from;
  if (!user) return ctx.reply("❌ اطلاعات کاربری شما یافت نشد.");

  supportMode.delete(user.id);
  adminReplyMode.delete(user.id);

  try {
    const chatMember = await ctx.api.getChatMember(REQUIRED_CHANNEL, user.id);
    const isMember = !(
      chatMember.status === "left" || chatMember.status === "kicked"
    );

    if (!isMember) {
      await ctx.reply(
        `👋 <b>سلام ${user.first_name} عزیز!</b>\n\n⚠️ <b>دسترسی شما غیرفعال است!</b>\nبرای استفاده از خدمات رایگان ربات، ابتدا باید در کانال ما عضو شوید.\n\n🔹 پس از عضویت در کانال زیر، مجدداً دستور /start را ارسال کنید.`,
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
        .text("⚙️ تنظیمات سیستم", "admin_settings")
        .row()
        .text("👤 ورود به پنل کاربری", "go_to_user_panel")
        .row()
        .text("❌ بستن منو", "admin_close");
      await ctx.reply(
        "🔐 <b>خوش آمدید مدیریت گرامی!</b>\nبه پنل ارزیابی و تنظیمات ربات دسترسی دارید:",
        {
          reply_markup: adminKeyboard,
          parse_mode: "HTML",
        },
      );
    } else {
      await ctx.reply(
        `👋 <b>سلام ${user.first_name} عزیز، به ربات خودت خوش آمدی!</b>\n\n👇 از طریق دکمه‌های زیر می‌تونی به راحتی و کاملاً رایگان، جدیدترین کانفیگ‌ها و پروکسی‌های پرسرعت رو دریافت کنی:`,
        { reply_markup: mainMenuKeyboard, parse_mode: "HTML" },
      );
    }

    saveUserToDB(user).catch(console.error);
  } catch (error: any) {
    console.error("Error checking membership:", error.message || error);
    await ctx.reply(
      "⚠️ <b>اختلال موقت!</b>\nخطایی در بررسی عضویت شما رخ داده است. لطفاً چند لحظه دیگر دوباره تلاش کنید.",
      { parse_mode: "HTML" },
    );
  }
});

bot.command("update", async (ctx) => {
  if (ctx.chat?.type !== "private") return;
  if (ctx.from?.id !== ADMIN_ID)
    return ctx.reply("⛔ شما مجاز به اجرای این دستور نیستید.");
  await ctx.reply(
    "🔄 <b>در حال جمع‌آوری و به‌روزرسانی دستی کانفیگ‌ها...</b>\nلطفاً شکیبا باشید.",
    { parse_mode: "HTML" },
  );
  await updateConfigs();
  await ctx.reply(
    "✅ <b>به‌روزرسانی با موفقیت انجام شد!</b>\nآخرین کانفیگ‌ها در فایل‌ها ذخیره شدند.",
    { parse_mode: "HTML" },
  );
});

async function sendConfigFile(ctx: any, filePath: string, configName: string) {
  if (fs.existsSync(filePath)) {
    const fileContent = fs.readFileSync(filePath, "utf-8");

    const configCount = fileContent
      .split("\n")
      .filter(
        (line) =>
          line.trim().startsWith("vless://") ||
          line.trim().startsWith("vmess://") ||
          line.trim().startsWith("ss://") ||
          line.trim().startsWith("trojan://"),
      ).length;

    const timeString = new Date().toLocaleTimeString("fa-IR", {
      hour: "2-digit",
      minute: "2-digit",
    });

    const graphicCaption =
      `╔══════════════════════╗\n` +
      `🚀 ${configName.toUpperCase()} CONFIGS\n` +
      `📊 Total: ${configCount || "جدید"}\n` +
      `🕒 Update: ${timeString}\n` +
      `╚══════════════════════╝\n\n` +
      `🔹 فایل بالا شامل لیست کامل کانفیگ‌ها است.\n\n` +
      `📢 @${ctx.me.username}`;

    await ctx.replyWithDocument(new InputFile(filePath), {
      caption: graphicCaption,
      parse_mode: "HTML",
    });
  } else {
    await ctx.reply(
      `⚙️ <b>فایل کانفیگ ${configName} در حال حاضر آماده نیست!</b>\nلطفاً دقایقی دیگر مجدداً تلاش کنید یا با پشتیبانی در ارتباط باشید.`,
      { parse_mode: "HTML" },
    );
  }
}

async function sendProxyText(ctx: any, filePath: string) {
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, "utf-8");
    if (!content.trim()) {
      await ctx.reply(
        "🔌 <b>پروکسی فعال و جدیدی یافت نشد!</b>\nبه زودی لیست پروکسی‌ها آپدیت می‌شود.",
        {
          parse_mode: "HTML",
        },
      );
      return;
    }
    await sendLongText(ctx, content);
  } else {
    await ctx.reply(
      "⚠️ <b>لیست پروکسی‌ها یافت نشد!</b>\nلطفاً کمی بعد دوباره امتحان کنید.",
      {
        parse_mode: "HTML",
      },
    );
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
      `💡 <b>راهنمای استفاده از ربات</b>\n\n` +
        `🔹 برای دسترسی به بخش‌های ربات، حتماً باید در کانال ${REQUIRED_CHANNEL} عضو بمانید.\n` +
        `🔹 کانفیگ‌های <b>v2ray</b> و <b>slipnet</b> جهت سهولت در کپیِ یکجا، به صورت فایل متنی ارسال می‌شوند.\n` +
        `🔹 <b>پروکسی‌ها</b> به صورت متن مستقیم فرستاده می‌شوند تا با یک کلیک متصل شوید.\n` +
        `🔄 تمام خروجی‌ها <b>هر یک ساعت یک‌بار</b> به صورت کاملاً خودکار آپدیت می‌شوند.\n\n` +
        `📌 <i>جهت بازگشت به منوی اصلی دستور /start را بفرستید.</i>`,
      { parse_mode: "HTML" },
    );
  });
});

bot.callbackQuery("channel", async (ctx) => {
  await ctx.answerCallbackQuery();
  await withTempMessage(ctx, async () => {
    await ctx.reply(
      `📢 <b>کانال رسمی ما</b>\n\nبرای باخبر شدن از آخرین اخبار ربات، قطعی‌ها و دریافت اطلاعات بیشتر به کانال ما بپیوندید:\n👉 ${REQUIRED_CHANNEL}`,
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
      `🎧 <b>مرکز پشتیبانی آنلاین</b>\n\nشما وارد حالت ارتباط با اپراتور شدید.\n\n✍️ لطفاً پیام، انتقاد یا مشکل خود را در <u>یک پیام متنی</u> ارسال کنید. پیام شما مستقیماً به دست مدیریت می‌رسد.\n\n❌ <i>برای لغو این حالت و برگشت به منو، دستور /start را بفرستید.</i>`,
      { parse_mode: "HTML" },
    );
  });
});

bot.on("message:text", async (ctx) => {
  if (ctx.chat?.type !== "private") return;

  const userId = ctx.from.id;

  if (adminReplyMode.has(userId)) {
    const targetUserId = adminReplyMode.get(userId)!;
    const replyText = ctx.message.text;
    try {
      await bot.api.sendMessage(
        targetUserId,
        `💬 <b>پاسخ پشتیبانی برای شما:</b>\n\n${replyText}\n\n📌 <i>برای پاسخ مجدد یا دریافت کانفیگ /start را بزنید.</i>`,
        { parse_mode: "HTML" },
      );
      await ctx.reply("✅ پاسخ شما با موفقیت برای کاربر ارسال شد.");
    } catch (error: any) {
      console.error("Failed to send reply:", error.message || error);
      await ctx.reply(
        "❌ <b>خطا در ارسال!</b>\nپاسخ ارسال نشد. احتمال دارد کاربر ربات را بلاک یا متوقف کرده باشد.",
      );
    }
    adminReplyMode.delete(userId);
    return;
  }

  if (supportMode.has(userId)) {
    const userMessage = ctx.message.text;
    const userInfo = ctx.from;
    const forwardText = `📥 <b>پیام پشتیبانی جدید</b>\n\n👤 <b>فرستنده:</b> ${userInfo.first_name} ${userInfo.last_name || ""}\n🆔 <b>آیدی عددی:</b> <code>${userInfo.id}</code>\n🔗 <b>یوزرنیم:</b> @${userInfo.username || "ندارد"}\n\n📝 <b>متن پیام:</b>\n${userMessage}`;
    const replyKeyboard = new InlineKeyboard().text(
      "✍️ پاسخ به این کاربر",
      `reply_to_${userInfo.id}`,
    );

    try {
      if (ADMIN_ID !== 0) {
        await bot.api.sendMessage(ADMIN_ID, forwardText, {
          parse_mode: "HTML",
          reply_markup: replyKeyboard,
        });
        await ctx.reply(
          "✅ <b>پیام شما با موفقیت به بخش پشتیبانی ارسال شد.</b>\nبه زودی بررسی شده و پاسخ آن در همین‌جا برای شما فرستاده می‌شود.",
          { parse_mode: "HTML" },
        );
      } else {
        await ctx.reply(
          "⚠️ <b>سیستم پشتیبانی موقتاً غیرفعال است!</b>\nلطفاً بعداً اقدام کنید.",
          {
            parse_mode: "HTML",
          },
        );
      }
    } catch (error: any) {
      console.error(
        "Failed to forward support message:",
        error.message || error,
      );
      await ctx.reply(
        "⚠️ <b>خطا در ارسال پیام!</b>\nمشکلی پیش آمد، لطفاً دوباره پیام خود را بفرستید.",
        {
          parse_mode: "HTML",
        },
      );
    }
    supportMode.delete(userId);
    return;
  }

  if (userId === ADMIN_ID) {
    const adminKeyboard = new InlineKeyboard()
      .text("📊 آمار کاربران", "admin_stats")
      .row()
      .text("📢 ارسال همگانی", "admin_broadcast")
      .row()
      .text("👥 لیست کاربران", "admin_users_list")
      .row()
      .text("⚙️ تنظیمات سیستم", "admin_settings")
      .row()
      .text("👤 ورود به پنل کاربری", "go_to_user_panel")
      .row()
      .text("❌ بستن منو", "admin_close");
    await ctx.reply(
      "⚙️ <b>مدیریت گرامی؛</b>\nلطفاً از دکمه‌های پنل زیر استفاده کنید یا برای بازنشانی وضعیت دستور /start را بفرستید.",
      { reply_markup: adminKeyboard, parse_mode: "HTML" },
    );
  } else {
    await ctx.reply(
      "🤖 <b>متوجه دستور شما نشدم!</b>\nلطفاً برای استفاده از خدمات ربات، از دکمه‌های منوی زیر استفاده کنید یا دستور /start را بفرستید.",
      { reply_markup: mainMenuKeyboard, parse_mode: "HTML" },
    );
  }
});

bot.callbackQuery(/reply_to_(\d+)/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (ctx.from.id !== ADMIN_ID) {
    await ctx.reply("⛔ شما مجاز به پاسخگویی نیستید.");
    return;
  }
  const match = ctx.match[1];
  if (!match) {
    await ctx.reply("❌ خطا در شناسایی آیدی کاربر.");
    return;
  }
  const targetUserId = parseInt(match, 10);
  adminReplyMode.set(ADMIN_ID, targetUserId);
  await ctx.reply(
    "✏️ <b>پاسخ خود را بنویسید:</b>\nمتن خود را ارسال کنید (قابلیت استفاده از تگ‌های HTML وجود دارد).",
    { parse_mode: "HTML" },
  );
  await ctx.deleteMessage();
});

async function sendOnlineStatus() {
  if (ADMIN_ID === 0) return;
  const uptime = Math.floor((Date.now() - START_TIME) / 1000);
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const seconds = uptime % 60;
  const statusText = `🟢 <b>گزارش وضعیت سیستم</b>\n\n✅ ربات فعال و آنلاین است.\n⏱ <b>آپتایم:</b> ${hours} ساعت و ${minutes} دقیقه\n🕒 <b>زمان ثبت:</b> ${new Date().toLocaleString("fa-IR")}`;
  try {
    await bot.api.sendMessage(ADMIN_ID, statusText, { parse_mode: "HTML" });
    console.log("Online status sent to admin");
  } catch (err: any) {
    console.error("Failed to send online status:", err.message || err);
  }
}

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
  } catch (err: any) {
    console.warn("Could not drop index 'id_1':", err.message || err);
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

  setInterval(sendOnlineStatus, 5 * 60 * 1000);
  sendOnlineStatus().catch(console.error);
}

main().catch(console.error);
