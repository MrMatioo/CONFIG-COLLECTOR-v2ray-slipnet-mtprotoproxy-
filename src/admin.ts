import { Bot, Context, InlineKeyboard } from "grammy";
import { UserModel } from "./schemas/userSchema.js";
import * as dotenv from "dotenv";
dotenv.config();

const ADMIN_ID = Number(process.env.ADMIN_ID);
if (!ADMIN_ID) console.warn("ADMIN_ID not set. Admin panel disabled.");

let userMenuKeyboard: InlineKeyboard | null = null;

export function setUserMenuKeyboard(keyboard: InlineKeyboard): void {
  userMenuKeyboard = keyboard;
}

function getAdminMenuKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .text("📊 آمار کاربران", "admin_stats")
    .row()
    .text("📢 ارسال همگانی", "admin_broadcast")
    .row()
    .text("👥 لیست کاربران", "admin_users_list")
    .row()
    .text("⚙️ تنظیمات", "admin_settings")
    .row()
    .text("🔙 بستن منو", "admin_close");

  if (userMenuKeyboard) {
    keyboard.row().text("👤 پنل کاربری", "go_to_user_panel");
  }
  return keyboard;
}

interface BroadcastSession {
  step: "awaiting_forward" | "awaiting_confirmation";
  sourceChatId?: number;
  sourceMessageId?: number;
}

const broadcastSessions = new Map<number, BroadcastSession>();
const USERS_PER_PAGE = 10;

interface BotSettings {
  welcomeMessage: string;
  forceJoinMessage: string;
  channelLink: string;
}

let settings: BotSettings = {
  welcomeMessage: "<b>سلام</b> {first_name} عزیز!",
  forceJoinMessage:
    "<b>دسترسی غیرفعال!</b>\n\nبرای استفاده از ربات باید در کانال ما عضو باشید.\n\nلطفاً روی دکمه زیر کلیک کرده و پس از عضویت، مجدداً /start را ارسال کنید.",
  channelLink: `https://t.me/${(process.env.REQUIRED_CHANNEL || "configCollectore").replace("@", "")}`,
};

export function setupAdminPanel(bot: Bot): void {
  bot.use(async (ctx: Context, next: () => Promise<void>) => {
    if (ctx.from?.id === ADMIN_ID) {
      await next();
    } else if (ctx.callbackQuery?.data?.startsWith("admin_")) {
      await ctx.answerCallbackQuery("شما دسترسی به پنل ادمین ندارید.");
    }
  });

  bot.command("admin", async (ctx: Context) => {
    if (ctx.from?.id !== ADMIN_ID) return;
    await ctx.reply("🔐 پنل مدیریت", {
      reply_markup: getAdminMenuKeyboard(),
      parse_mode: "HTML",
    });
  });

  bot.callbackQuery("go_to_user_panel", async (ctx: Context) => {
    await ctx.answerCallbackQuery();
    if (userMenuKeyboard) {
      await ctx.reply("👤 پنل کاربری", {
        reply_markup: userMenuKeyboard,
        parse_mode: "HTML",
      });
      await ctx.deleteMessage().catch(() => {});
    } else {
      await ctx.reply("منوی کاربری در دسترس نیست.");
    }
  });

  bot.callbackQuery("admin_stats", async (ctx: Context) => {
    await ctx.answerCallbackQuery();
    const total = await UserModel.countDocuments();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const joinedToday = await UserModel.countDocuments({
      joinedAt: { $gte: today },
    });
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const activeLast7Days = await UserModel.countDocuments({
      lastActiveAt: { $gte: weekAgo },
    });
    const premium = await UserModel.countDocuments({ isPremium: true });

    const statsText = `
<b>📊 آمار کاربران</b>

👥 کل کاربران: ${total}
🆕 عضو شده امروز: ${joinedToday}
📱 فعال در ۷ روز اخیر: ${activeLast7Days}
⭐ کاربران پریمیوم: ${premium}
    `;
    await ctx.editMessageText(statsText, {
      reply_markup: new InlineKeyboard().text("🔙 برگشت", "admin_back_to_menu"),
      parse_mode: "HTML",
    });
  });

  bot.callbackQuery("admin_broadcast", async (ctx: Context) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from?.id) return;
    broadcastSessions.set(ctx.from.id, { step: "awaiting_forward" });
    await ctx.editMessageText(
      "📢 <b>ارسال همگانی به روش فوروارد</b>\n\n" +
        "لطفاً پیام مورد نظر (متن، عکس، ویدیو، فایل، استیکر و ...) را به همین ربات <b>فوروارد کنید</b>.\n\n" +
        "⚠️ توجه: پیام فوروارد شده دقیقاً با همان ظاهر و با ذکر فرستنده اصلی برای همه کاربران ارسال خواهد شد.\n\n" +
        "برای لغو، دستور /cancel را بفرستید.",
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard().text(
          "❌ لغو",
          "admin_cancel_broadcast",
        ),
      },
    );
  });

  bot.callbackQuery("admin_cancel_broadcast", async (ctx: Context) => {
    if (ctx.from?.id) broadcastSessions.delete(ctx.from.id);
    await ctx.editMessageText("❌ ارسال همگانی لغو شد.", {
      reply_markup: getAdminMenuKeyboard(),
    });
  });

  bot.on("message", async (ctx: Context, next: () => Promise<void>) => {
    if (ctx.from?.id !== ADMIN_ID) return await next();
    const session = broadcastSessions.get(ctx.from.id);
    if (!session) return await next();

    if (ctx.message?.text === "/cancel") {
      broadcastSessions.delete(ctx.from.id);
      await ctx.reply("لغو شد.", { reply_markup: getAdminMenuKeyboard() });
      return;
    }

    if (session.step === "awaiting_forward") {
      if (!ctx.message) {
        await ctx.reply("⚠️ لطفاً یک پیام معتبر فوروارد کنید.");
        return;
      }
      session.sourceChatId = ctx.message.chat.id;
      session.sourceMessageId = ctx.message.message_id;
      session.step = "awaiting_confirmation";

      const confirmKeyboard = new InlineKeyboard()
        .text("✅ بله، ارسال کن", "admin_confirm_broadcast")
        .text("❌ خیر، لغو", "admin_cancel_broadcast");

      await ctx.reply("✉️ <b>پیش‌نمایش پیام فوروارد شده:</b>", {
        parse_mode: "HTML",
      });
      await ctx.reply("⬇️ پیام شما به این صورت برای همه ارسال خواهد شد:");

      if (ctx.chat && session.sourceChatId && session.sourceMessageId) {
        await ctx.api.forwardMessage(
          ctx.chat.id,
          session.sourceChatId,
          session.sourceMessageId,
        );
      }

      await ctx.reply("\nآیا می‌خواهید این پیام برای همه کاربران ارسال شود؟", {
        reply_markup: confirmKeyboard,
        parse_mode: "HTML",
      });
    }
  });

  bot.callbackQuery("admin_confirm_broadcast", async (ctx: Context) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from?.id) return;
    const session = broadcastSessions.get(ctx.from.id);
    if (!session || !session.sourceChatId || !session.sourceMessageId) {
      await ctx.editMessageText("خطا: پیامی یافت نشد.");
      broadcastSessions.delete(ctx.from.id);
      return;
    }
    broadcastSessions.delete(ctx.from.id);
    await ctx.editMessageText(
      "⏳ در حال ارسال همگانی به کاربران... لطفاً صبر کنید.",
    );

    const userCursor = UserModel.find({}, "telegramId").cursor();
    let success = 0,
      failed = 0;

    for (
      let user = await userCursor.next();
      user != null;
      user = await userCursor.next()
    ) {
      try {
        await bot.api.forwardMessage(
          user.telegramId,
          session.sourceChatId,
          session.sourceMessageId,
        );
        success++;
        await new Promise((r) => setTimeout(r, 50));
      } catch {
        failed++;
      }
    }

    await ctx.reply(
      `✅ ارسال همگانی پایان یافت.\n\nموفق: ${success}\nناموفق: ${failed}`,
      { reply_markup: getAdminMenuKeyboard() },
    );
  });

  async function showUserListPage(ctx: Context, page: number): Promise<void> {
    const skip = (page - 1) * USERS_PER_PAGE;
    const users = await UserModel.find({})
      .sort({ joinedAt: -1 })
      .skip(skip)
      .limit(USERS_PER_PAGE);
    const total = await UserModel.countDocuments();
    const totalPages = Math.ceil(total / USERS_PER_PAGE) || 1;

    let text = "<b>👥 لیست کاربران</b>\n\n";
    for (const u of users) {
      text += `🆔 ${u.telegramId} | ${u.firstName} ${u.lastName || ""} | ${u.username ? "@" + u.username : "بدون یوزر"} | ${u.isPremium ? "⭐پریمیوم" : "عادی"}\n`;
    }
    text += `\nصفحه ${page} از ${totalPages}`;
    const keyboard = new InlineKeyboard();
    if (page > 1) keyboard.text("◀️ قبلی", `admin_users_page_${page - 1}`);
    if (page < totalPages)
      keyboard.text("بعدی ▶️", `admin_users_page_${page + 1}`);
    keyboard.row().text("🔙 برگشت", "admin_back_to_menu");
    await ctx.editMessageText(text, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  }

  bot.callbackQuery(/admin_users_page_(\d+)/, async (ctx: Context) => {
    const pageMatch = ctx.match ? ctx.match[1] : null;
    if (!pageMatch) return ctx.answerCallbackQuery("خطا در شماره صفحه.");
    const page = parseInt(pageMatch, 10);
    await showUserListPage(ctx, page);
  });

  bot.callbackQuery("admin_users_list", async (ctx: Context) => {
    await ctx.answerCallbackQuery();
    await showUserListPage(ctx, 1);
  });

  bot.callbackQuery("admin_settings", async (ctx: Context) => {
    await ctx.answerCallbackQuery();
    const text = `
<b>⚙️ تنظیمات ربات</b>

🔹 <b>متن خوش‌آمدگویی:</b>
${settings.welcomeMessage}

🔹 <b>متن عضویت اجباری:</b>
${settings.forceJoinMessage}

🔹 <b>لینک کانال:</b>
${settings.channelLink}

برای تغییر هر کدام، دستور زیر را بفرستید:
/set_welcome "متن جدید"
/set_forcejoin "متن جدید"
/set_channellink "https://t.me/..."
    `;
    await ctx.editMessageText(text, {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text("🔙 برگشت", "admin_back_to_menu"),
    });
  });

  bot.command("set_welcome", async (ctx: Context) => {
    if (ctx.from?.id !== ADMIN_ID) return;
    const msgText = ctx.message?.text;
    if (!msgText) return;
    const newText = msgText.replace("/set_welcome", "").trim();
    if (!newText) return ctx.reply("لطفاً متن جدید را بعد از دستور وارد کنید.");
    settings.welcomeMessage = newText;
    await ctx.reply("✅ متن خوش‌آمدگویی با موفقیت تغییر کرد.");
  });

  bot.command("set_forcejoin", async (ctx: Context) => {
    if (ctx.from?.id !== ADMIN_ID) return;
    const msgText = ctx.message?.text;
    if (!msgText) return;
    const newText = msgText.replace("/set_forcejoin", "").trim();
    if (!newText) return ctx.reply("لطفاً متن جدید را وارد کنید.");
    settings.forceJoinMessage = newText;
    await ctx.reply("✅ متن عضویت اجباری تغییر کرد.");
  });

  bot.command("set_channellink", async (ctx: Context) => {
    if (ctx.from?.id !== ADMIN_ID) return;
    const msgText = ctx.message?.text;
    if (!msgText) return;
    let link = msgText.replace("/set_channellink", "").trim();
    if (!link) return ctx.reply("لطفاً لینک کانال را وارد کنید.");
    if (!link.startsWith("https://t.me/"))
      link = "https://t.me/" + link.replace("@", "");
    settings.channelLink = link;
    await ctx.reply("✅ لینک کانال تغییر کرد.");
  });

  bot.callbackQuery("admin_back_to_menu", async (ctx: Context) => {
    await ctx.editMessageText("🔐 پنل مدیریت", {
      reply_markup: getAdminMenuKeyboard(),
      parse_mode: "HTML",
    });
  });

  bot.callbackQuery("admin_close", async (ctx: Context) => {
    await ctx.deleteMessage().catch(() => {});
  });

  async function sendDailyReport(): Promise<void> {
    try {
      const total = await UserModel.countDocuments();
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const joinedToday = await UserModel.countDocuments({
        joinedAt: { $gte: today },
      });
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const activeLast7Days = await UserModel.countDocuments({
        lastActiveAt: { $gte: weekAgo },
      });
      const report = `
📅 <b>گزارش روزانه ربات</b>

📊 آمار امروز:
- کل کاربران: ${total}
- کاربران جدید امروز: ${joinedToday}
- کاربران فعال هفته اخیر: ${activeLast7Days}
      `;
      await bot.api.sendMessage(ADMIN_ID, report, { parse_mode: "HTML" });
    } catch (err) {
      console.error("Failed to send daily report:", err);
    }
  }

  const scheduleDailyReport = (): void => {
    const now = new Date();
    const next9AM = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
      9,
      0,
      0,
      0,
    );
    const msToMorning = next9AM.getTime() - now.getTime();
    setTimeout(() => {
      sendDailyReport();
      setInterval(sendDailyReport, 24 * 60 * 60 * 1000);
    }, msToMorning);
  };
  scheduleDailyReport();
}

export function isAdminInBroadcastMode(adminId: number): boolean {
  return broadcastSessions.has(adminId);
}

export function getSettings(): BotSettings {
  return settings;
}
