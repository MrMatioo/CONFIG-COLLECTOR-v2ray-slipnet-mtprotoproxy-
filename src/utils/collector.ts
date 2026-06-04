import { TelegramClient } from "telegram";
import fs from "fs";
import * as dotenv from "dotenv";
dotenv.config();

let targetChannels: string[];

const defaultChannels: string[] = [
  "@ProxyMtAlpha",
  "@vpn_jet7",
  "@SPARTAN_YT",
  "@iMTProto",
  "@v2dogs_n",
  "@v2dogs_gp",
  "@vasl_bashim",
  "@ChtNknV",
  "@NabiProxy",
  "@vpnbaz",
  "@Gp_config",
  "@vpnplusee_free",
  "@configraygan",
  "@privateVPNS",
  "@vayzone",
  "@Config_magazine",
  "@configshere",
  "@virous_config",
  "@SlipNet0",
  "@v2rayngvpn",
];

function shuffleArray<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
}

try {
  const envChannels = process.env.TARGET_CHANNELS;
  if (envChannels && envChannels.trim() !== "") {
    targetChannels = JSON.parse(envChannels);
    if (!Array.isArray(targetChannels))
      throw new Error("TARGET_CHANNELS is not an array");
  } else {
    targetChannels = defaultChannels;
  }
} catch (err) {
  console.warn("Failed to parse TARGET_CHANNELS, using default channels.");
  targetChannels = defaultChannels;
}

const BOT_USERNAME = process.env.BOT_USERNAME || "@unknown_bot";

interface Rule {
  name: string;
  prefixes: string[];
  file: string;
}

const rules: Rule[] = [
  {
    name: "v2ray",
    prefixes: ["vmess://", "vless://", "trojan://", "ss://"],
    file: "./v2ray_configs.txt",
  },
  {
    name: "proxy",
    prefixes: ["https://t.me/proxy?server=", "tg://proxy?server"],
    file: "./proxy.txt",
  },
  {
    name: "slipnet",
    prefixes: ["slipnet-enc:", "slipnet:"],
    file: "./slipnet_configs.txt",
  },
];

export const collector = async (client: TelegramClient): Promise<void> => {
  const sets = new Map<string, Set<string>>();
  for (const r of rules) {
    sets.set(r.name, new Set<string>());
  }

  const shuffledChannels = shuffleArray(targetChannels);
  console.log("Channel order (random):", shuffledChannels);

  for (const channel of shuffledChannels) {
    try {
      const messages = await client.getMessages(channel, { limit: 3 });

      for (const msg of messages) {
        if (msg?.message && typeof msg.message === "string") {
          const words = msg.message.split(/[\s\n\r]+/);

          for (const word of words) {
            const clean = word.trim();
            if (!clean) continue;

            for (const r of rules) {
              const isMatch = r.prefixes.some((p) =>
                clean.toLowerCase().startsWith(p.toLowerCase()),
              );

              if (isMatch) {
                sets.get(r.name)?.add(clean);
                break;
              }
            }
          }

          if (msg.entities && msg.entities.length > 0) {
            for (const entity of msg.entities) {
              if (entity.className === "MessageEntityTextUrl" && entity.url) {
                const url = entity.url.trim();

                for (const r of rules) {
                  const isMatch = r.prefixes.some((p) =>
                    url.toLowerCase().startsWith(p.toLowerCase()),
                  );

                  if (isMatch) {
                    sets.get(r.name)?.add(url);
                    break;
                  }
                }
              }
            }
          }
        }
      }
    } catch (err) {
      console.error(`Error fetching from ${channel}:`, err);
    }
  }

  const now = new Date();
  const formattedDateTime = now.toLocaleString("en-US", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  for (const r of rules) {
    const configSet = sets.get(r.name);
    if (configSet && configSet.size > 0) {
      const header =
        `╔══════════════════════╗\n` +
        ` 🚀 ${r.name.toUpperCase()} COLLECTOR\n` +
        ` 📊 Total: ${configSet.size}\n` +
        ` 📅 ${formattedDateTime}\n` +
        `╚══════════════════════╝\n\n`;

      const body = Array.from(configSet).join("\n──────────────────────\n");

      const footer =
        `\n\n╔══════════════════════╗\n` +
        ` 🤖 Bot: ${BOT_USERNAME}\n` +
        ` ✨ Enjoy Free Connection\n` +
        `╚══════════════════════╝`;

      const finalContent = header + body + footer;

      fs.writeFileSync(r.file, finalContent, "utf-8");
      console.log(`${r.name}: ${configSet.size} config(s) saved`);
    } else {
      console.log(`${r.name}: no config found`);
    }
  }
};
