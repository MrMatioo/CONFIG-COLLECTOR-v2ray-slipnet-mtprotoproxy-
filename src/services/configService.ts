import fs from "fs";
import path from "path";
import { configCache, proxyCache } from "../utils/cache.js";
import logger from "../utils/logger.js";

export function loadConfigFile(
  filePath: string,
  cacheKey: string,
): string | null {
  const cached = configCache.get(cacheKey);
  if (cached) return cached;

  if (!fs.existsSync(filePath)) return null;
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    if (!content.trim()) return null;
    configCache.set(cacheKey, content);
    return content;
  } catch (err: any) {
    logger.error(`Failed to read ${filePath}: ${err.message}`);
    return null;
  }
}

export function loadProxyFile(filePath: string): string | null {
  const cached = proxyCache.get("proxy");
  if (cached) return cached;

  if (!fs.existsSync(filePath)) return null;
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    if (!content.trim()) return null;
    proxyCache.set("proxy", content);
    return content;
  } catch (err: any) {
    logger.error(`Failed to read proxy file: ${err.message}`);
    return null;
  }
}

export function clearConfigCache() {
  configCache.clear();
  proxyCache.clear();
  logger.info("Config cache cleared");
}
