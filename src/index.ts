import "dotenv/config";
import { Bot, session, Context } from "grammy";
import { conversations, createConversation, ConversationFlavor } from "@grammyjs/conversations";
import { SessionFlavor } from "grammy";
import { authMiddleware } from "./middleware/auth";
import { addProjectConversation } from "./conversations/addProject";
import { addCommandConversation } from "./conversations/addCommand";
import { handleVpsCommand } from "./handlers/vps";
import { projectComposer } from "./handlers/project";
import { commandComposer } from "./handlers/command";
import { handleDeployCommand } from "./handlers/deploy";
import { runnerMiddleware } from "./handlers/runner";
import { handleHelp } from "./handlers/help";

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN environment variable is required");
}

type SessionData = { selectedProject?: string };
type BotContext = Context & SessionFlavor<SessionData> & ConversationFlavor<Context>;

const bot = new Bot<BotContext>(BOT_TOKEN);

bot.use(session({ initial: (): SessionData => ({}) }));
bot.use(conversations());
bot.use(createConversation(addProjectConversation, "addProject"));
bot.use(createConversation(addCommandConversation, "addCommand"));

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

bot.use(projectComposer);
bot.use(commandComposer);
bot.use(runnerMiddleware);

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
