import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/StringSession.js";
import fs from "fs";
import readline from "readline";
import * as dotenv from "dotenv";
dotenv.config();

const SESSION_FILE = "./session.txt";
let memoizedClient: TelegramClient | null = null;
const SESSION = process.env.SESSIONSTRING;

function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// function getStringSession(): string {
//   if (fs.existsSync(SESSION_FILE)) {
//     return fs.readFileSync(SESSION_FILE, "utf-8").trim();
//   }
//   return "";
// }

function saveStringSession(session: string): void {
  fs.writeFileSync(SESSION_FILE, session, "utf-8");
}

export async function getTelegramClient(): Promise<TelegramClient> {
  if (memoizedClient) return memoizedClient;

  const apiId = Number(process.env.API_ID);
  const apiHash = process.env.API_HASH;
  if (!apiId || !apiHash) {
    throw new Error("API_ID or API_HASH is missing in .env config");
  }

  // const sessionStr = getStringSession();
  // const session = new StringSession(SESSION);

  const client = new TelegramClient(SESSION as string, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => await askQuestion("Enter your number: "),
    password: async () => await askQuestion("Enter your password: "),
    phoneCode: async () => await askQuestion("Enter the code you received: "),
    onError: (err: Error) => console.log("GramJS internal error:", err),
  });

  const savedSession = client.session.save() as unknown as string;
  saveStringSession(savedSession);

  console.log("Telegram client connected");
  memoizedClient = client;
  return client;
}
