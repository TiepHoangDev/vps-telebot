import "dotenv/config";
import { Bot, session } from "grammy";
import { conversations, createConversation } from "@grammyjs/conversations";
import { authMiddleware } from "./middleware/auth";
import { addProjectConversation } from "./conversations/addProject";
import { handleVpsCommand } from "./handlers/vps";
import { projectComposer } from "./handlers/project";
import { commandComposer } from "./handlers/command";
import { handleDeployCommand } from "./handlers/deploy";
import { runnerMiddleware } from "./handlers/runner";
import { handleHelp } from "./handlers/help";
import { inputMiddleware } from "./handlers/input";
import { fileBrowserComposer } from "./handlers/filebrowser";
import { BotContext, SessionData } from "./types";

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN environment variable is required");
}

const bot = new Bot<BotContext>(BOT_TOKEN);

bot.use(session({ initial: (): SessionData => ({}) }));
bot.use(conversations());
bot.use(createConversation(addProjectConversation, "addProject"));

// /deploy bypasses auth — validated by secret key
bot.command("deploy", async (ctx: BotContext) => {
  await handleDeployCommand(ctx);
});

bot.use(authMiddleware);

bot.command(["start", "help"], async (ctx: BotContext) => {
  await handleHelp(ctx);
});

bot.command("vps", async (ctx: BotContext) => {
  await handleVpsCommand(ctx);
});

bot.use(inputMiddleware);
bot.use(projectComposer);
bot.use(fileBrowserComposer);
bot.use(commandComposer);
bot.use(runnerMiddleware);

bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`Error handling update ${ctx.update.update_id}:`, err.error);
  ctx.answerCallbackQuery?.().catch(() => {});
});

bot.api.setMyCommands([
  { command: "help", description: "Show all commands & projects" },
  { command: "addproject", description: "Add a docker compose project" },
  { command: "vps", description: "Show VPS resource usage" },
]);

const shutdown = () => {
  console.log("Shutting down...");
  bot.stop();
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

async function startBot() {
  try {
    await bot.api.setChatMenuButton({ menu_button: { type: "commands" } });
    await bot.start({
      onStart: (botInfo) => console.log(`Bot started: @${botInfo.username}`),
    });
  } catch (err: any) {
    if (err?.error_code === 409) {
      console.log("409 Conflict — retrying in 5s...");
      setTimeout(startBot, 5000);
    } else {
      throw err;
    }
  }
}

startBot();
