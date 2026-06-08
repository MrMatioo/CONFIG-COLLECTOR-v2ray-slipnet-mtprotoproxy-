import axios from "axios";
import fs from "fs";
import path from "path";
import logger from "./utils/logger.js";

const BALE_TOKEN = process.env.BALE_BOT_TOKEN;
const BALE_ADMIN_ID = Number(process.env.BALE_ADMIN_ID) || 0;
const BALE_API = `https://tapi.bale.ai/bot${BALE_TOKEN}`;

// کیبورد شبیه به تلگرام برای بله
const baleMenuKeyboard = {
  inline_keyboard: [
    [{ text: "🚀 دریافت کانفیگ v2ray", callback_data: "bale_v2ray" }],
    [{ text: "🛡️ دریافت کانفیگ slipnet", callback_data: "bale_slipnet" }],
    [{ text: "🔗 دریافت پروکسی تلگرام", callback_data: "bale_proxy" }],
  ],
};

// تابع ارسال منوی اصلی به بله شما
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

// تابع فرستادن خود فایل متنی با هدر و فوتر به بله
async function sendFileToBale(filePath: string, fileName: string) {
  const url = `${BALE_API}/sendDocument`;
  if (!fs.existsSync(filePath)) {
    return axios.post(`${BALE_API}/sendMessage`, {
      chat_id: BALE_ADMIN_ID,
      text: "⚠️ فایل مورد نظر هنوز ساخته نشده است.",
    });
  }

  const fileStream = fs.createReadStream(filePath);
  const formData = new FormData();
  formData.append("chat_id", String(BALE_ADMIN_ID));
  formData.append("document", fileStream as any, fileName);

  return axios.post(url, formData);
}

// گوش دادن به دکمه‌های بله (Long Polling ساده مخصوص بله)
export function startBaleBotPolling() {
  if (!BALE_TOKEN) return;
  let offset = 0;

  setInterval(async () => {
    try {
      const response = await axios.get(`${BALE_API}/getUpdates`, {
        params: { offset, timeout: 30 },
      });

      const updates = response.data?.result || [];
      for (const update of updates) {
        offset = update.update_id + 1;

        // بررسی کلیک روی دکمه‌ها
        if (update.callback_query) {
          const cb = update.callback_query;
          const data = cb.data;
          const fromId = cb.from?.id;

          // فقط به خودت پاسخ بده
          if (fromId !== BALE_ADMIN_ID) continue;

          // تایید زدن دکمه
          await axios
            .post(`${BALE_API}/answerCallbackQuery`, {
              callback_query_id: cb.id,
            })
            .catch(() => {});

          if (data === "bale_v2ray") {
            await sendFileToBale(
              path.resolve("./v2ray_configs.txt"),
              "v2ray_configs.txt",
            ).catch((e) => logger.error(e.message));
          } else if (data === "bale_slipnet") {
            await sendFileToBale(
              path.resolve("./slipnet_configs.txt"),
              "slipnet_configs.txt",
            ).catch((e) => logger.error(e.message));
          } else if (data === "bale_proxy") {
            await sendFileToBale(
              path.resolve("./proxy.txt"),
              "proxy.txt",
            ).catch((e) => logger.error(e.message));
          }
        }
      }
    } catch (error: any) {
      // خطاها را بی‌آزار لاگ کن تا ربات متوقف نشود
    }
  }, 3000);
}
