import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/StringSession.js";
import fs from "fs";
import readline from "readline";
import * as dotenv from "dotenv";
dotenv.config();

const SESSION_FILE = "./session.txt";

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

function getStringSession(): string {
  if (fs.existsSync(SESSION_FILE)) {
    return fs.readFileSync(SESSION_FILE, "utf-8");
  }
  return "";
}

function saveStringSession(session: string) {
  fs.writeFileSync(SESSION_FILE, session);
}

export async function getTelegramClient(): Promise<TelegramClient> {
  const apiId = Number(process.env.API_ID);
  const apiHash = process.env.API_HASH!;
  const sessionStr = getStringSession();
  const session = new StringSession(sessionStr);

  const client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => await askQuestion("Enter your number: "),
    password: async () => await askQuestion("Enter your password: "),
    phoneCode: async () => await askQuestion("Enter the code you received: "),
    onError: (err) => console.log(err),
  });

  const savedSession = client.session.save() + "";
  saveStringSession(savedSession);

  console.log("Telegram client connected");
  return client;
}
