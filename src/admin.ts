import { Bot, InlineKeyboard } from "grammy";
import { UserModel } from "./schemas/userSchema.js";
import * as dotenv from "dotenv";
dotenv.config();

const ADMIN_ID = Number(process.env.ADMIN_ID);
if (!ADMIN_ID) console.warn("ADMIN_ID not set. Admin panel disabled.");

let userMenuKeyboard: InlineKeyboard | null = null;

export function setUserMenuKeyboard(keyboard: InlineKeyboard) {
  userMenuKeyboard = keyboard;
}

function getAdminMenuKeyboard() {
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

const broadcastSessions = new Map<
  number,
  { step: "awaiting_text" | "awaiting_confirmation"; text?: string }
>();
const USERS_PER_PAGE = 10;

let settings = {
  welcomeMessage: "<b>سلام</b> {first_name} عزیز!",
  forceJoinMessage:
    "<b>دسترسی غیرفعال!</b>\n\nبرای استفاده از ربات باید در کانال ما عضو باشید.\n\nلطفاً روی دکمه زیر کلیک کرده و پس از عضویت، مجدداً /start را ارسال کنید.",
  channelLink: "https://t.me/configCollectore",
};

export function setupAdminPanel(bot: Bot) {
  // Middleware to restrict admin actions
  bot.use(async (ctx, next) => {
    if (ctx.from?.id === ADMIN_ID) {
      await next();
    } else if (ctx.callbackQuery?.data?.startsWith("admin_")) {
      await ctx.answerCallbackQuery("شما دسترسی به پنل ادمین ندارید.");
    }
  });

  // Admin command
  bot.command("admin", async (ctx) => {
    if (ctx.from?.id !== ADMIN_ID) return;
    await ctx.reply("🔐 پنل مدیریت", {
      reply_markup: getAdminMenuKeyboard(),
      parse_mode: "HTML",
    });
  });

  // Go to user panel
  bot.callbackQuery("go_to_user_panel", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (userMenuKeyboard) {
      await ctx.reply("👤 پنل کاربری", {
        reply_markup: userMenuKeyboard,
        parse_mode: "HTML",
      });
      await ctx.deleteMessage();
    } else {
      await ctx.reply("منوی کاربری در دسترس نیست.");
    }
  });

  // ========== Stats ==========
  bot.callbackQuery("admin_stats", async (ctx) => {
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

  // ========== Broadcast ==========
  bot.callbackQuery("admin_broadcast", async (ctx) => {
    await ctx.answerCallbackQuery();
    broadcastSessions.set(ctx.from.id, { step: "awaiting_text" });
    await ctx.editMessageText(
      "📢 <b>ارسال همگانی</b>\n\nلطفاً متن پیام خود را ارسال کنید.\n(می‌تواند شامل HTML باشد)\n\nبرای لغو /cancel را بفرستید.",
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard().text(
          "❌ لغو",
          "admin_cancel_broadcast",
        ),
      },
    );
  });

  bot.callbackQuery("admin_cancel_broadcast", async (ctx) => {
    broadcastSessions.delete(ctx.from.id);
    await ctx.editMessageText("❌ ارسال همگانی لغو شد.", {
      reply_markup: getAdminMenuKeyboard(),
    });
  });

  bot.on("message:text", async (ctx) => {
    if (ctx.from?.id !== ADMIN_ID) return;
    const session = broadcastSessions.get(ctx.from.id);
    if (!session) return;
    const messageText = ctx.message.text;
    if (messageText === "/cancel") {
      broadcastSessions.delete(ctx.from.id);
      await ctx.reply("لغو شد.", { reply_markup: getAdminMenuKeyboard() });
      return;
    }
    if (session.step === "awaiting_text") {
      session.text = messageText;
      session.step = "awaiting_confirmation";
      const confirmKeyboard = new InlineKeyboard()
        .text("✅ بله، ارسال کن", "admin_confirm_broadcast")
        .text("❌ خیر، لغو", "admin_cancel_broadcast");
      await ctx.reply(
        "✉️ <b>پیش‌نمایش پیام:</b>\n\n" +
          messageText +
          "\n\nآیا می‌خواهید برای همه کاربران ارسال شود؟",
        { parse_mode: "HTML", reply_markup: confirmKeyboard },
      );
    }
  });

  bot.callbackQuery("admin_confirm_broadcast", async (ctx) => {
    await ctx.answerCallbackQuery();
    const session = broadcastSessions.get(ctx.from.id);
    if (!session || !session.text) {
      await ctx.editMessageText("خطا: پیامی یافت نشد.");
      broadcastSessions.delete(ctx.from.id);
      return;
    }
    const messageText = session.text;
    broadcastSessions.delete(ctx.from.id);
    await ctx.editMessageText(
      "⏳ در حال ارسال پیام به کاربران... لطفاً صبر کنید.",
    );
    const users = await UserModel.find({}, "telegramId");
    let success = 0,
      failed = 0;
    for (const user of users) {
      try {
        await bot.api.sendMessage(user.telegramId, messageText, {
          parse_mode: "HTML",
        });
        success++;
        await new Promise((r) => setTimeout(r, 50));
      } catch {
        failed++;
      }
    }
    await ctx.editMessageText(
      `✅ ارسال همگانی پایان یافت.\n\nموفق: ${success}\nناموفق: ${failed}`,
      { reply_markup: getAdminMenuKeyboard() },
    );
  });

  // ========== User List ==========
  async function showUserListPage(ctx: any, page: number) {
    const skip = (page - 1) * USERS_PER_PAGE;
    const users = await UserModel.find({})
      .sort({ joinedAt: -1 })
      .skip(skip)
      .limit(USERS_PER_PAGE);
    const total = await UserModel.countDocuments();
    const totalPages = Math.ceil(total / USERS_PER_PAGE);
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

  bot.callbackQuery(/admin_users_page_(\d+)/, async (ctx) => {
    const pageMatch = ctx.match[1];
    if (!pageMatch) {
      await ctx.answerCallbackQuery("خطا در شماره صفحه.");
      return;
    }
    const page = parseInt(pageMatch, 10);
    await showUserListPage(ctx, page);
  });

  bot.callbackQuery("admin_users_list", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showUserListPage(ctx, 1);
  });

  // ========== Settings ==========
  bot.callbackQuery("admin_settings", async (ctx) => {
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

  // Admin commands for settings
  bot.command("set_welcome", async (ctx) => {
    if (ctx.from?.id !== ADMIN_ID) return;
    const msgText = ctx.message?.text;
    if (!msgText) return;
    const newText = msgText.replace("/set_welcome", "").trim();
    if (!newText) return ctx.reply("لطفاً متن جدید را بعد از دستور وارد کنید.");
    settings.welcomeMessage = newText;
    await ctx.reply("✅ متن خوش‌آمدگویی با موفقیت تغییر کرد.");
  });

  bot.command("set_forcejoin", async (ctx) => {
    if (ctx.from?.id !== ADMIN_ID) return;
    const msgText = ctx.message?.text;
    if (!msgText) return;
    const newText = msgText.replace("/set_forcejoin", "").trim();
    if (!newText) return ctx.reply("لطفاً متن جدید را وارد کنید.");
    settings.forceJoinMessage = newText;
    await ctx.reply("✅ متن عضویت اجباری تغییر کرد.");
  });

  bot.command("set_channellink", async (ctx) => {
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

  // ========== Back to main admin menu ==========
  bot.callbackQuery("admin_back_to_menu", async (ctx) => {
    await ctx.editMessageText("🔐 پنل مدیریت", {
      reply_markup: getAdminMenuKeyboard(),
      parse_mode: "HTML",
    });
  });

  bot.callbackQuery("admin_close", async (ctx) => {
    await ctx.deleteMessage();
  });

  // ========== Daily auto report ==========
  async function sendDailyReport() {
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
    try {
      await bot.api.sendMessage(ADMIN_ID, report, { parse_mode: "HTML" });
    } catch (err) {
      console.error("Failed to send daily report:", err);
    }
  }

  const scheduleDailyReport = () => {
    const now = new Date();
    const next9AM = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
      9,
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

export function getSettings() {
  return settings;
}
