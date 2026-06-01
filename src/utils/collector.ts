import { TelegramClient } from "telegram";
import fs from "fs";
import * as dotenv from "dotenv";
dotenv.config();

let targetChannels: string[];

const defaultChannels = [
  "@ProxyMtAlpha",
  "@vpn_jet7",
  "@SPARTAN_YT",
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
];

try {
  const envChannels = process.env.TARGET_CHANNELS;
  if (envChannels && envChannels.trim() !== "") {
    targetChannels = JSON.parse(envChannels);
    if (!Array.isArray(targetChannels)) {
      throw new Error("TARGET_CHANNELS is not an array");
    }
  } else {
    console.warn("TARGET_CHANNELS not set, using default channels.");
    targetChannels = defaultChannels;
  }
} catch (err) {
  console.error(
    "Failed to parse TARGET_CHANNELS, using default channels.",
    err,
  );
  targetChannels = defaultChannels;
}

const BOT_USERNAME = process.env.BOT_USERNAME || "@unknown_bot";

const rules = [
  {
    name: "v2ray",
    prefixes: ["vmess", "vless", "trojan", "ss:"],
    file: "./v2ray_configs.txt",
  },
  {
    name: "proxy",
    prefixes: ["tg://", "https://t.me/proxy", "mtproto://", "MTProto:"],
    file: "./proxy.txt",
  },
  {
    name: "slipnet",
    prefixes: ["slipnet-enc:", "slipnet:"],
    file: "./slipnet_configs.txt",
  },
];

export const collector = async (client: TelegramClient) => {
  const sets = new Map<string, Set<string>>();
  for (const r of rules) {
    sets.set(r.name, new Set<string>());
  }

  for (const channel of targetChannels) {
    try {
      const messages = await client.getMessages(channel, { limit: 6 });
      for (const msg of messages) {
        if (msg.message && typeof msg.message === "string") {
          const words = msg.message.split(/\s+/);
          for (const word of words) {
            const clean = word.trim();
            if (!clean) continue;
            for (const r of rules) {
              if (r.prefixes.some((p) => clean.startsWith(p))) {
                sets.get(r.name)?.add(clean);
                break;
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
  const footer = `\n\n\n[ Last update: ${formattedDateTime} | Bot: ${BOT_USERNAME} ]`;

  for (const r of rules) {
    const configSet = sets.get(r.name);
    if (configSet && configSet.size > 0) {
      let content = Array.from(configSet).join("\n\n\n");
      content += footer;
      fs.writeFileSync(r.file, content, "utf-8");
      console.log(`${r.name}: ${configSet.size} config(s) saved`);
    } else {
      console.log(`${r.name}: no config found`);
    }
  }
};
