import { Middleware, InputFile } from "grammy";
import { readData } from "../storage";
import { handleHelp } from "./help";
import { runCommand } from "../executor";

export const runnerMiddleware: Middleware<any> = async (ctx, next) => {
  if (!ctx.from?.id) return next();

  const message = ctx.message?.text;
  if (!message) return next();

  if (!message.startsWith("/")) return handleHelp(ctx);

  let commandName = message.substring(1).split(" ")[0];
  if (commandName.includes("@")) commandName = commandName.split("@")[0];

  const reservedCommands = ["addproject", "vps", "start", "help", "deploy"];
  if (reservedCommands.includes(commandName)) return next();

  const data = readData();
  let shellCommand: string | null = null;
  for (const project of Object.values(data.projects)) {
    if (project.commands[commandName]) { shellCommand = project.commands[commandName]; break; }
  }

  if (!shellCommand) {
    await ctx.reply(
      `❓ Unknown command <code>/${commandName}</code>. Use /help to see available commands.`,
      { parse_mode: "HTML" }
    );
    return;
  }

  const ackMsg = await ctx.reply(`⏳ Running <code>/${commandName}</code>...`, { parse_mode: "HTML" });
  await ctx.replyWithChatAction("typing");
  const typingInterval = setInterval(() => ctx.replyWithChatAction("typing").catch(() => {}), 4000);

  try {
    await runCommand(commandName, shellCommand, async () => {
      const editFn = async (text: string) => {
        try {
          await ctx.api.editMessageText(ctx.chat.id, ackMsg.message_id, text, { parse_mode: "HTML" });
        } catch {
          await ctx.reply(text, { parse_mode: "HTML" });
        }
      };
      const sendFileFn = async (buf: Buffer, name: string) => {
        await ctx.replyWithDocument(new InputFile(buf, name));
      };
      return { chatId: ctx.chat.id, messageId: ackMsg.message_id, editFn, sendFileFn };
    });
  } finally {
    clearInterval(typingInterval);
  }
};
