import * as fs from "fs";
import * as path from "path";
import { BotData } from "./types";

const dataPath = process.env.DATA_PATH || "./data.json";

export function readData(): BotData {
  try {
    if (!fs.existsSync(dataPath)) {
      const defaultData: BotData = {
        allowed_users: [],
        projects: {},
      };
      writeData(defaultData);
      return defaultData;
    }
    const content = fs.readFileSync(dataPath, "utf-8");
    return JSON.parse(content) as BotData;
  } catch (error) {
    const defaultData: BotData = {
      allowed_users: [],
      projects: {},
    };
    return defaultData;
  }
}

export function writeData(data: BotData): void {
  const dir = path.dirname(dataPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), "utf-8");
}
