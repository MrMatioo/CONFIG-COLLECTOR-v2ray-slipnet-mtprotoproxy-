import { Bot, InlineKeyboard, InputFile, GrammyError, HttpError } from "grammy";
import mongoose from "mongoose";
import http from "http";
import fs from "fs";
import path from "path";
import { UserModel } from "./schemas/userSchema.js";
import { SupportSessionModel } from "./schemas/supportSessionSchema.js";
import { collector } from "./utils/collector.js";
import { getTelegramClient } from "./client.js";
import {
  setupAdminPanel,
  setUserMenuKeyboard,
  getSettings,
  isAdminInBroadcastMode,
} from "./admin.js";
import { saveUserToDB, updateLastActive } from "./services/userService.js";
import {
  loadConfigFile,
  loadProxyFile,
  clearConfigCache,
} from "./services/configService.js";
import { isRateLimited } from "./utils/rateLimit.js";
import { sanitizeHtml } from "./utils/sanitize.js";
import logger from "./utils/logger.js";
import { statusCommand } from "./handlers/statusHandler.js";
import * as dotenv from "dotenv";

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  logger.error("BOT_TOKEN is not set.");
  process.exit(1);
}

const MONGODB_URI = process.env.MONGODB_URI;
const REQUIRED_CHANNEL = process.env.REQUIRED_CHANNEL || "@configCollectore";
const ADMIN_ID = Number(process.env.ADMIN_ID) || 0;
const STICKER_FILE_ID = process.env.STICKER_FILE_ID || "";
const START_TIME = Date.now();

if (ADMIN_ID === 0) {
  logger.warn("ADMIN_ID not set.");
}

const bot = new Bot(BOT_TOKEN);

bot.catch((err) => {
  const ctx = err.ctx;
  logger.error(`Error handling update ${ctx.update.update_id}: ${err.error}`);
  const e = err.error;
  if (e instanceof GrammyError) {
    if (e.description.includes("message is not modified")) return;
    if (
      e.description.includes("bot was blocked") ||
      e.description.includes("chat not found")
    ) {
      logger.warn(`User blocked bot. Chat ID: ${ctx.chat?.id}`);
      return;
    }
    logger.error(`Telegram API error: ${e.description}`);
  } else if (e instanceof HttpError) {
    logger.error(`HTTP error: ${e}`);
  } else {
    logger.error(`Unknown error: ${e}`);
  }
});

async function sendLongText(ctx: any, text: string) {
  const MAX_LEN = 4096;
  if (text.length <= MAX_LEN) {
    await ctx
      .reply(text)
      .catch((e: any) => logger.warn(`sendLongText failed: ${e.message}`));
  } else {
    for (let i = 0; i < text.length; i += MAX_LEN) {
      await ctx
        .reply(text.slice(i, i + MAX_LEN))
        .catch((e: any) =>
          logger.warn(`sendLongText chunk failed: ${e.message}`),
        );
    }
  }
}

async function sendTempMessage(ctx: any): Promise<number | null> {
  if (STICKER_FILE_ID) {
    try {
      const stickerMsg = await ctx.replyWithSticker(STICKER_FILE_ID);
      return stickerMsg.message_id;
    } catch {
      try {
        const tempMsg = await ctx.reply("⏳ لطفاً چند لحظه صبر کنید...", {
          parse_mode: "HTML",
        });
        return tempMsg.message_id;
      } catch {
        return null;
      }
    }
  } else {
    try {
      const tempMsg = await ctx.reply("⏳ لطفاً چند لحظه صبر کنید...", {
        parse_mode: "HTML",
      });
      return tempMsg.message_id;
    } catch {
      return null;
    }
  }
}

async function deleteMessage(ctx: any, messageId: number) {
  try {
    await ctx.api.deleteMessage(ctx.chat.id, messageId);
  } catch (error: any) {
    logger.warn(`Failed to delete temp message: ${error.message}`);
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
  .text("🎧 پشتیبانی آنلاین", "support")
  .row()
  .text("📊 وضعیت", "status");

setUserMenuKeyboard(mainMenuKeyboard);

async function setSupportMode(userId: number, active: boolean) {
  if (active) {
    await SupportSessionModel.findOneAndUpdate(
      { userId },
      { isActive: true, updatedAt: new Date() },
      { upsert: true },
    );
  } else {
    await SupportSessionModel.deleteOne({ userId });
  }
}

async function isSupportModeActive(userId: number): Promise<boolean> {
  const session = await SupportSessionModel.findOne({ userId, isActive: true });
  return !!session;
}

const adminReplyMode = new Map<number, number>();

function extractV2rayLinks(filePath: string): string[] {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const links: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.startsWith("vless://") ||
      trimmed.startsWith("vmess://") ||
      trimmed.startsWith("ss://") ||
      trimmed.startsWith("trojan://")
    ) {
      links.push(trimmed);
    }
  }
  return links;
}

function extractSlipnetLinks(filePath: string): string[] {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const links: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("slipnet-enc:") || trimmed.startsWith("slipnet:")) {
      links.push(trimmed);
    }
  }
  return links;
}

function extractProxyLinks(filePath: string): string[] {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const links: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.startsWith("tg://proxy?") ||
      trimmed.startsWith("https://t.me/proxy?")
    ) {
      links.push(trimmed);
    }
  }
  return links;
}

async function sendPaginatedList(
  ctx: any,
  page: number,
  allItems: string[],
  title: string,
  callbackPrefix: string,
  messageId?: number,
) {
  const itemsPerPage = 12;
  const totalPages = Math.ceil(allItems.length / itemsPerPage);
  const start = (page - 1) * itemsPerPage;
  const end = start + itemsPerPage;
  const pageItems = allItems.slice(start, end);

  if (pageItems.length === 0) {
    await ctx.reply("⚠️ موردی یافت نشد.").catch(() => {});
    return;
  }

  const timeString = new Date().toLocaleTimeString("fa-IR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tehran",
  });

  const separator = "──────────────────────";
  const header = `╔══════════════════════╗\n🚀 ${title.toUpperCase()}\n🕒 ${timeString}\n📄 صفحه ${page} از ${totalPages}\n╚══════════════════════╝\n\n`;
  const body = pageItems.join(`\n${separator}\n`);
  const footer = `\n\n📊 مجموع: ${allItems.length} مورد`;
  let fullText = header + body + footer;

  if (fullText.length > 4096) {
    const saferItemsPerPage = Math.floor(itemsPerPage * 0.7);
    const newStart = (page - 1) * saferItemsPerPage;
    const newEnd = newStart + saferItemsPerPage;
    const saferItems = allItems.slice(newStart, newEnd);
    const saferBody = saferItems.join(`\n${separator}\n`);
    fullText = header + saferBody + footer;
  }

  const keyboard = new InlineKeyboard();
  if (page > 1) {
    keyboard.text("◀️ قبلی", `${callbackPrefix}_page_${page - 1}`);
  }
  if (page < totalPages) {
    keyboard.text("بعدی ▶️", `${callbackPrefix}_page_${page + 1}`);
  }
  keyboard.row().text("❌ بستن", "close_config_view");

  if (messageId) {
    await ctx.api
      .editMessageText(ctx.chat.id, messageId, fullText, {
        parse_mode: "HTML",
        reply_markup: keyboard,
      })
      .catch(() => {});
  } else {
    const msg = await ctx
      .reply(fullText, {
        parse_mode: "HTML",
        reply_markup: keyboard,
      })
      .catch(() => {});
    return msg;
  }
}

bot.command("start", async (ctx) => {
  if (ctx.chat?.type !== "private") {
    await ctx
      .reply("❌ دسترسی محدود! لطفاً در چت خصوصی استفاده کنید.", {
        parse_mode: "HTML",
      })
      .catch(() => {});
    return;
  }
  const user = ctx.from;
  if (!user) return ctx.reply("❌ اطلاعات کاربری یافت نشد.").catch(() => {});

  await setSupportMode(user.id, false);
  adminReplyMode.delete(user.id);

  try {
    const chatMember = await ctx.api.getChatMember(REQUIRED_CHANNEL, user.id);
    const isMember = !(
      chatMember.status === "left" || chatMember.status === "kicked"
    );

    if (!isMember) {
      await ctx.reply(
        `👋 سلام ${user.first_name} عزیز!\n⚠️ برای استفاده از خدمات ربات، ابتدا در کانال عضو شوید.\n🔹 پس از عضویت، /start را ارسال کنید.`,
        { reply_markup: channelLinkKeyboard, parse_mode: "HTML" },
      );
      return;
    }

    await saveUserToDB(user, false);

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
      await ctx.reply("🔐 خوش آمدید مدیریت گرامی!", {
        reply_markup: adminKeyboard,
        parse_mode: "HTML",
      });
    } else {
      await ctx.reply(
        `👋 سلام ${user.first_name} عزیز، به ربات خوش آمدی!\n👇 از دکمه‌های زیر کانفیگ‌های رایگان را دریافت کن:`,
        { reply_markup: mainMenuKeyboard, parse_mode: "HTML" },
      );
    }
  } catch (error: any) {
    logger.error(`Error checking membership for ${user.id}: ${error.message}`);
    await ctx
      .reply("⚠️ خطا در بررسی عضویت. لطفاً چند لحظه دیگر تلاش کنید.", {
        parse_mode: "HTML",
      })
      .catch(() => {});
  }
});

bot.command("status", async (ctx) => {
  if (ctx.from && ctx.from.id !== ADMIN_ID) {
    await statusCommand(ctx);
    await updateLastActive(ctx.from.id);
  }
});

bot.command("update", async (ctx) => {
  if (ctx.chat?.type !== "private") return;
  if (ctx.from?.id !== ADMIN_ID)
    return ctx.reply("⛔ شما مجاز نیستید.").catch(() => {});

  await ctx
    .reply("🔄 در حال به‌روزرسانی دستی کانفیگ‌ها...", { parse_mode: "HTML" })
    .catch(() => {});
  try {
    await updateConfigs();
    await ctx
      .reply("✅ به‌روزرسانی با موفقیت انجام شد!", { parse_mode: "HTML" })
      .catch(() => {});
  } catch (e) {
    logger.error("Manual update failed:", e);
  }
});

async function deduplicateFile(filePath: string): Promise<void> {
  if (!fs.existsSync(filePath)) return;
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const seen = new Set<string>();
    const uniqueLines: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === "") continue;
      if (!seen.has(trimmed)) {
        seen.add(trimmed);
        uniqueLines.push(line);
      }
    }
    const newContent =
      uniqueLines.join("\n") + (uniqueLines.length ? "\n" : "");
    fs.writeFileSync(filePath, newContent, "utf-8");
    logger.info(
      `Deduplicated: ${filePath} (${lines.length} -> ${uniqueLines.length} lines)`,
    );
  } catch (err: any) {
    logger.error(`Failed to deduplicate ${filePath}: ${err.message}`);
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

bot.use(async (ctx, next) => {
  if (ctx.callbackQuery && ctx.from) {
    if (isRateLimited(ctx.from.id)) {
      await ctx.answerCallbackQuery(
        "⏳ شما بیش از حد درخواست فرستادید. لطفاً یک دقیقه صبر کنید.",
      );
      return;
    }
  }
  await next();
});

bot.callbackQuery("getV2ray", async (ctx) => {
  await ctx.answerCallbackQuery().catch(() => {});
  const links = extractV2rayLinks(path.resolve("./v2ray_configs.txt"));
  if (links.length === 0) {
    await ctx.reply("⚠️ هیچ کانفیگ v2ray یافت نشد.").catch(() => {});
    return;
  }
  await withTempMessage(ctx, async () => {
    await sendPaginatedList(ctx, 1, links, "v2ray", "v2ray");
  });
});

bot.callbackQuery("getSlipnet", async (ctx) => {
  await ctx.answerCallbackQuery().catch(() => {});
  const links = extractSlipnetLinks(path.resolve("./slipnet_configs.txt"));
  if (links.length === 0) {
    await ctx.reply("⚠️ هیچ کانفیگ slipnet یافت نشد.").catch(() => {});
    return;
  }
  await withTempMessage(ctx, async () => {
    await sendPaginatedList(ctx, 1, links, "slipnet", "slipnet");
  });
});

bot.callbackQuery("getProxy", async (ctx) => {
  await ctx.answerCallbackQuery().catch(() => {});
  const links = extractProxyLinks(path.resolve("./proxy.txt"));
  if (links.length === 0) {
    await ctx.reply("⚠️ هیچ پروکسی یافت نشد.").catch(() => {});
    return;
  }
  await withTempMessage(ctx, async () => {
    await sendPaginatedList(ctx, 1, links, "proxy", "proxy");
  });
});

bot.callbackQuery("help", async (ctx) => {
  await ctx.answerCallbackQuery().catch(() => {});
  await withTempMessage(ctx, async () => {
    await ctx
      .reply(
        `💡 راهنمای استفاده\n\n` +
          `🔹 عضویت در کانال ${REQUIRED_CHANNEL} اجباری است.\n` +
          `🔹 کانفیگ‌ها و پروکسی‌ها به صورت صفحه‌بندی شده و در یک پیام ارسال می‌شوند.\n` +
          `🔄 تمام خروجی‌ها هر ساعت آپدیت می‌شوند.\n` +
          `🧹 کانفیگ‌های تکراری به طور خودکار حذف می‌شوند.\n\n` +
          `📌 برای بازگشت به منو، /start را بفرستید.`,
        { parse_mode: "HTML" },
      )
      .catch(() => {});
  });
});

bot.callbackQuery("channel", async (ctx) => {
  await ctx.answerCallbackQuery().catch(() => {});
  await withTempMessage(ctx, async () => {
    await ctx
      .reply(`📢 کانال رسمی ما\n\n👉 ${REQUIRED_CHANNEL}`, {
        reply_markup: channelLinkKeyboard,
        parse_mode: "HTML",
      })
      .catch(() => {});
  });
});

bot.callbackQuery("support", async (ctx) => {
  await ctx.answerCallbackQuery().catch(() => {});
  await withTempMessage(ctx, async () => {
    const userId = ctx.from.id;
    await setSupportMode(userId, true);
    await ctx
      .reply(
        `🎧 حالت پشتیبانی فعال شد.\nپیام خود را ارسال کنید.\n❌ برای لغو، /start را بفرستید.`,
        { parse_mode: "HTML" },
      )
      .catch(() => {});
  });
});

bot.callbackQuery("status", async (ctx) => {
  await ctx.answerCallbackQuery().catch(() => {});
  await statusCommand(ctx);
  await updateLastActive(ctx.from.id);
});

bot.callbackQuery(/v2ray_page_(\d+)/, async (ctx) => {
  await ctx.answerCallbackQuery().catch(() => {});
  const page = parseInt(ctx.match[1]!, 10);
  const links = extractV2rayLinks(path.resolve("./v2ray_configs.txt"));
  const messageId = ctx.callbackQuery.message?.message_id;
  if (messageId) {
    await sendPaginatedList(ctx, page, links, "v2ray", "v2ray", messageId);
  }
});

bot.callbackQuery(/slipnet_page_(\d+)/, async (ctx) => {
  await ctx.answerCallbackQuery().catch(() => {});
  const page = parseInt(ctx.match[1]!, 10);
  const links = extractSlipnetLinks(path.resolve("./slipnet_configs.txt"));
  const messageId = ctx.callbackQuery.message?.message_id;
  if (messageId) {
    await sendPaginatedList(ctx, page, links, "slipnet", "slipnet", messageId);
  }
});

bot.callbackQuery(/proxy_page_(\d+)/, async (ctx) => {
  await ctx.answerCallbackQuery().catch(() => {});
  const page = parseInt(ctx.match[1]!, 10);
  const links = extractProxyLinks(path.resolve("./proxy.txt"));
  const messageId = ctx.callbackQuery.message?.message_id;
  if (messageId) {
    await sendPaginatedList(ctx, page, links, "proxy", "proxy", messageId);
  }
});

bot.callbackQuery("close_config_view", async (ctx) => {
  await ctx.deleteMessage().catch(() => {});
});

bot.on("message:text", async (ctx) => {
  if (ctx.chat?.type !== "private") return;

  const userId = ctx.from.id;
  const messageText = ctx.message.text.trim();

  if (userId === ADMIN_ID && messageText.toLowerCase() === "ping") {
    await sendOnlineStatus();
    return;
  }

  if (adminReplyMode.has(userId)) {
    const targetUserId = adminReplyMode.get(userId)!;
    const replyText = sanitizeHtml(ctx.message.text);
    try {
      await bot.api.sendMessage(
        targetUserId,
        `💬 پاسخ پشتیبانی:\n\n${replyText}\n\n📌 برای ادامه /start را بزنید.`,
        { parse_mode: "HTML" },
      );
      await ctx.reply("✅ پاسخ شما ارسال شد.").catch(() => {});
      logger.info(`Admin replied to user ${targetUserId}`);
    } catch (error: any) {
      logger.error(`Failed to send reply to ${targetUserId}: ${error.message}`);
      await ctx.reply("❌ خطا در ارسال پاسخ.").catch(() => {});
    }
    adminReplyMode.delete(userId);
    return;
  }

  if (await isSupportModeActive(userId)) {
    const userMessage = sanitizeHtml(ctx.message.text);
    if (userMessage.length > 1000) {
      await ctx
        .reply("⚠️ پیام شما خیلی طولانی است (حداکثر ۱۰۰۰ کاراکتر).")
        .catch(() => {});
      return;
    }
    const userInfo = ctx.from;
    const forwardText = `📥 پیام پشتیبانی جدید\n\n👤 ${userInfo.first_name} ${userInfo.last_name || ""}\n🆔 <code>${userInfo.id}</code>\n🔗 @${userInfo.username || "ندارد"}\n\n📝 ${userMessage}`;
    const replyKeyboard = new InlineKeyboard().text(
      "✍️ پاسخ",
      `reply_to_${userInfo.id}`,
    );

    try {
      if (ADMIN_ID !== 0) {
        await bot.api.sendMessage(ADMIN_ID, forwardText, {
          parse_mode: "HTML",
          reply_markup: replyKeyboard,
        });
        await ctx.reply("✅ پیام شما به پشتیبانی ارسال شد.").catch(() => {});
        logger.info(`Support message from ${userId} forwarded to admin`);
      } else {
        await ctx.reply("⚠️ سیستم پشتیبانی غیرفعال است.").catch(() => {});
      }
    } catch (error: any) {
      logger.error(`Failed to forward support message: ${error.message}`);
      await ctx
        .reply("⚠️ خطا در ارسال پیام. دوباره تلاش کنید.")
        .catch(() => {});
    }
    await setSupportMode(userId, false);
    return;
  }

  if (userId === ADMIN_ID) {
    if (isAdminInBroadcastMode(userId)) {
      return;
    }
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
    await ctx
      .reply("⚙️ مدیریت گرامی، از دکمه‌های پنل استفاده کنید.", {
        reply_markup: adminKeyboard,
        parse_mode: "HTML",
      })
      .catch(() => {});
  } else {
    await ctx
      .reply(
        "🤖 متوجه نشدم! لطفاً از دکمه‌های منو استفاده کنید یا /start را بفرستید.",
        { reply_markup: mainMenuKeyboard, parse_mode: "HTML" },
      )
      .catch(() => {});
  }
});

bot.callbackQuery(/reply_to_(\d+)/, async (ctx) => {
  await ctx.answerCallbackQuery().catch(() => {});
  if (ctx.from.id !== ADMIN_ID) {
    await ctx.reply("⛔ شما مجاز نیستید.").catch(() => {});
    return;
  }
  const match = ctx.match[1];
  if (!match) {
    await ctx.reply("❌ خطا در شناسایی کاربر.").catch(() => {});
    return;
  }
  const targetUserId = parseInt(match, 10);
  adminReplyMode.set(ADMIN_ID, targetUserId);
  await ctx
    .reply("✏️ پاسخ خود را بنویسید:", { parse_mode: "HTML" })
    .catch(() => {});
  await ctx.deleteMessage().catch(() => {});
});

async function sendOnlineStatus() {
  if (ADMIN_ID === 0) return;
  const uptime = Math.floor((Date.now() - START_TIME) / 1000);
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const now = new Date();
  const statusText = `🟢 گزارش وضعیت سیستم\n\n✅ ربات فعال است\n⏱ آپتایم: ${hours} ساعت و ${minutes} دقیقه\n🕒 زمان ثبت: ${now.toLocaleString("fa-IR", { timeZone: "Asia/Tehran" })}`;
  try {
    await bot.api.sendMessage(ADMIN_ID, statusText, { parse_mode: "HTML" });
    logger.info("Online status sent to admin");
  } catch (err: any) {
    logger.error(`Failed to send online status: ${err.message}`);
  }
}

let telegramClient: any = null;

async function updateConfigs() {
  if (!telegramClient) return;
  try {
    logger.info("Collecting configs...");
    await collector(telegramClient);
    logger.info("Collection finished.");

    await deduplicateFile(path.resolve("./v2ray_configs.txt"));
    await deduplicateFile(path.resolve("./slipnet_configs.txt"));
    await deduplicateFile(path.resolve("./proxy.txt"));

    clearConfigCache();
  } catch (e) {
    logger.error("Error running config collector:", e);
  }
}

async function dropConflictingIndex() {
  try {
    const collection = mongoose.connection.collection("users");
    const indexes = await collection.indexes();
    const idIndex = indexes.find((idx) => idx.name === "id_1");
    if (idIndex) {
      await collection.dropIndex("id_1");
      logger.info("Dropped old index 'id_1' from users collection.");
    }
  } catch (err: any) {
    logger.warn(`Could not drop index 'id_1': ${err.message}`);
  }
}

async function main() {
  if (!MONGODB_URI) {
    logger.error("MONGODB_URI missing!");
    process.exit(1);
  }
  await mongoose.connect(MONGODB_URI);
  logger.info("Database connected.");

  await dropConflictingIndex();

  setupAdminPanel(bot);

  getTelegramClient()
    .then((client) => {
      telegramClient = client;
      updateConfigs();
      setInterval(
        async () => {
          try {
            await updateConfigs();
          } catch (e) {
            logger.error(e);
          }
        },
        60 * 60 * 1000,
      );
    })
    .catch((err) => logger.error("Failed to get Telegram client:", err));

  bot.start().catch((err) => {
    logger.error("Fatal Bot Start Error:", err);
  });
  logger.info("Bot started successfully.");
}

const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Bot is running...\n");
  })
  .listen(PORT, () => {
    logger.info(`Fake web server listening on port ${PORT}.`);
  });

main().catch((err) => logger.error("Main error:", err));
