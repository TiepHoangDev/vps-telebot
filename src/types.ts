import { Context, SessionFlavor } from "grammy";
import { ConversationFlavor } from "@grammyjs/conversations";

export interface Project {
  path: string;
  deploy_secret?: string;
  commands: Record<string, Record<string, string>>;
}

export interface BotData {
  allowed_users: number[];
  projects: Record<string, Project>;
}

export type SessionData = {
  awaitingInput?: "cmd_suffix" | "cmd_shell" | "send_file";
  pendingProject?: string;
  pendingCmdSuffix?: string;
  fbDir?: string;
  fbProject?: string;
  fbSelected?: string;
  fbItems?: string[];
  fbAllItems?: string[];
  fbPage?: number;
  fbMessageId?: number;
  fbMode?: 'addproject';
};

export type BotContext = Context & SessionFlavor<SessionData> & ConversationFlavor<Context>;
