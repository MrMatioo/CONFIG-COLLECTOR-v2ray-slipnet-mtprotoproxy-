import { Context } from "grammy";
import fs from "fs";
import path from "path";

function countConfigs(filePath: string): number {
  if (!fs.existsSync(filePath)) return 0;
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter((line) => {
    const trimmed = line.trim();
    return (
      trimmed.startsWith("vless://") ||
      trimmed.startsWith("vmess://") ||
      trimmed.startsWith("ss://") ||
      trimmed.startsWith("trojan://")
    );
  });
  return lines.length;
}

function countProxies(filePath: string): number {
  if (!fs.existsSync(filePath)) return 0;
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter((line) => {
    const trimmed = line.trim();
    return (
      trimmed.startsWith("tg://proxy?") ||
      trimmed.startsWith("https://t.me/proxy?")
    );
  });
  return lines.length;
}

export async function statusCommand(ctx: Context) {
  if (ctx.chat?.type !== "private") return;
  const now = new Date();
  const v2rayCount = countConfigs(path.resolve("./v2ray_configs.txt"));
  const slipnetCount = countConfigs(path.resolve("./slipnet_configs.txt"));
  const proxyCount = countProxies(path.resolve("./proxy.txt"));

  const statusText = `
📊 <b>وضعیت ربات</b>

🟢 <b>وضعیت:</b> آنلاین
🚀 <b>تعداد کانفیگ v2ray:</b> ${v2rayCount}
🛡️ <b>تعداد کانفیگ slipnet:</b> ${slipnetCount}
🔗 <b>تعداد پروکسی تلگرام:</b> ${proxyCount}
🕒 <b>زمان سرور (ایران):</b> ${now.toLocaleString("fa-IR", { timeZone: "Asia/Tehran" })}

📌 برای دریافت کانفیگ‌ها از دکمه‌های منو استفاده کنید.
  `;
  await ctx.reply(statusText, { parse_mode: "HTML" });
}
