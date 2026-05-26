import * as fs from "fs";
import * as path from "path";
import { BotData, Project } from "./types";

const dataPath = process.env.DATA_PATH || "./data.json";

const DOCKER_SUFFIXES = ["_up", "_down", "_downv", "_logs", "_pull", "_deploy"];

export const GROUP_ICONS: Record<string, string> = {
  Docker: "🐳",
  Custom: "⚡",
};

export function groupLabel(name: string): string {
  return `${GROUP_ICONS[name] ?? "📦"} ${name}`;
}

export function findCommand(project: Project, cmdName: string): string | null {
  for (const group of Object.values(project.commands)) {
    if (group[cmdName] !== undefined) return group[cmdName];
  }
  return null;
}

export function deleteCommand(project: Project, cmdName: string): boolean {
  for (const [groupName, group] of Object.entries(project.commands)) {
    if (group[cmdName] !== undefined) {
      delete group[cmdName];
      if (Object.keys(group).length === 0 && groupName !== "Custom") {
        delete project.commands[groupName];
      }
      return true;
    }
  }
  return false;
}

export function allCommands(project: Project): Record<string, string> {
  const result: Record<string, string> = {};
  for (const group of Object.values(project.commands)) {
    Object.assign(result, group);
  }
  return result;
}

function needsMigration(commands: Record<string, any>): boolean {
  const values = Object.values(commands);
  return values.length > 0 && typeof values[0] === "string";
}

function migrateCommands(flat: Record<string, string>): Record<string, Record<string, string>> {
  const docker: Record<string, string> = {};
  const custom: Record<string, string> = {};
  for (const [name, shell] of Object.entries(flat)) {
    if (DOCKER_SUFFIXES.some(s => name.endsWith(s))) docker[name] = shell;
    else custom[name] = shell;
  }
  const result: Record<string, Record<string, string>> = {};
  if (Object.keys(docker).length > 0) result["Docker"] = docker;
  if (Object.keys(custom).length > 0) result["Custom"] = custom;
  return result;
}

export function readData(): BotData {
  try {
    if (!fs.existsSync(dataPath)) {
      const defaultData: BotData = { allowed_users: [], projects: {} };
      writeData(defaultData);
      return defaultData;
    }
    const data = JSON.parse(fs.readFileSync(dataPath, "utf-8")) as BotData;

    let migrated = false;
    for (const project of Object.values(data.projects)) {
      if (needsMigration(project.commands as any)) {
        project.commands = migrateCommands(project.commands as any);
        migrated = true;
      }
    }
    if (migrated) writeData(data);

    return data;
  } catch {
    return { allowed_users: [], projects: {} };
  }
}

export function writeData(data: BotData): void {
  const dir = path.dirname(dataPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), "utf-8");
}
