import axios from "axios";
import fs from "fs";
import path from "path";
import logger from "./utils/logger.js";

const BALE_TOKEN = process.env.BALE_BOT_TOKEN;
const BALE_ADMIN_ID = Number(process.env.BALE_ADMIN_ID) || 0;
const BALE_API = `https://tapi.bale.ai/bot${BALE_TOKEN}`;

// کیبورد بله
const baleMenuKeyboard = {
  inline_keyboard: [
    [{ text: "🚀 دریافت کانفیگ v2ray", callback_data: "bale_v2ray" }],
    [{ text: "🛡️ دریافت کانفیگ slipnet", callback_data: "bale_slipnet" }],
    [{ text: "🔗 دریافت پروکسی تلگرام", callback_data: "bale_proxy" }],
  ],
};

// ارسال منوی اصلی
export async function sendMenuToBale(): Promise<void> {
  if (!BALE_TOKEN || !BALE_ADMIN_ID) return;
  try {
    await axios.post(`${BALE_API}/sendMessage`, {
      chat_id: BALE_ADMIN_ID,
      text: "🤖 کانفیگ‌های جدید آماده هستند. از دکمه‌های زیر دریافت کنید:",
      reply_markup: baleMenuKeyboard,
    });
    logger.info("Menu sent to Bale admin.");
  } catch (error: any) {
    logger.error(`Failed to send menu to Bale: ${error.message}`);
  }
}

// خواندن مستقیم متن فایل و ارسال به بله (بدون نیاز به FormData)
async function sendConfigContentText(filePath: string) {
  if (!fs.existsSync(filePath)) {
    return axios.post(`${BALE_API}/sendMessage`, {
      chat_id: BALE_ADMIN_ID,
      text: "⚠️ فایل مورد نظر هنوز توسط کالکتور ساخته نشده است.",
    });
  }

  // خواندن متن داخل فایل (همراه با هدر و فوتر دقیقی که کالکتور ساخته)
  const fileContent = fs.readFileSync(filePath, "utf-8");

  if (!fileContent.trim()) {
    return axios.post(`${BALE_API}/sendMessage`, {
      chat_id: BALE_ADMIN_ID,
      text: "⚠️ فایل خالی است.",
    });
  }

  // بله مثل تلگرام محدودیت ۴۰۹۶ کاراکتر دارد، اگر متن بزرگ بود خردش می‌کنیم
  if (fileContent.length <= 4096) {
    return axios.post(`${BALE_API}/sendMessage`, {
      chat_id: BALE_ADMIN_ID,
      text: fileContent,
    });
  } else {
    for (let i = 0; i < fileContent.length; i += 4000) {
      await axios.post(`${BALE_API}/sendMessage`, {
        chat_id: BALE_ADMIN_ID,
        text: fileContent.slice(i, i + 4000),
      });
    }
  }
}

// پولینگ بله
export function startBaleBotPolling() {
  if (!BALE_TOKEN) return;
  let offset = 0;

  setInterval(async () => {
    try {
      const response = await axios.get(`${BALE_API}/getUpdates`, {
        params: { offset, timeout: 10 },
      });

      const updates = response.data?.result || [];
      for (const update of updates) {
        offset = update.update_id + 1;

        if (update.callback_query) {
          const cb = update.callback_query;
          const data = cb.data;
          const fromId = cb.from?.id;

          if (fromId !== BALE_ADMIN_ID) continue;

          // پاسخ فوری به دکمه برای باز شدن قفل آن در بله
          await axios
            .post(`${BALE_API}/answerCallbackQuery`, {
              callback_query_id: cb.id,
            })
            .catch(() => {});

          // ارسال متن کانفیگ‌ها بر اساس دکمه زده شده
          if (data === "bale_v2ray") {
            await sendConfigContentText(
              path.resolve("./v2ray_configs.txt"),
            ).catch((e) => logger.error(e.message));
          } else if (data === "bale_slipnet") {
            await sendConfigContentText(
              path.resolve("./slipnet_configs.txt"),
            ).catch((e) => logger.error(e.message));
          } else if (data === "bale_proxy") {
            await sendConfigContentText(path.resolve("./proxy.txt")).catch(
              (e) => logger.error(e.message),
            );
          }
        }
      }
    } catch (error: any) {
      // نادیده گرفتن خطاهای نتورک یا تایم‌اوت پواینگ
    }
  }, 2000);
}
