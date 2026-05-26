import { Context, Composer } from "grammy";
import { InlineKeyboard } from "grammy";
import { readData, writeData } from "../storage";
import { log } from "../logger";

export const commandComposer = new Composer<Context>();

// Handles delcmd flow triggered from project view buttons
commandComposer.on("callback_query:data", async (ctx, next) => {
  const data = ctx.callbackQuery.data;

  if (data.startsWith("delcmd_project:")) {
    const projectName = data.replace("delcmd_project:", "");
    const botData = readData();
    const project = botData.projects[projectName];

    if (!project || Object.keys(project.commands).length === 0) {
      await ctx.answerCallbackQuery();
      await ctx.reply("❌ No commands in this project");
      return;
    }

    const keyboard = new InlineKeyboard();
    Object.keys(project.commands).forEach(cmdName =>
      keyboard.text(cmdName, `delcmd_confirm:${projectName}:${cmdName}`).row()
    );
    await ctx.answerCallbackQuery();
    await ctx.reply("Select command to delete:", { reply_markup: keyboard });

  } else if (data.startsWith("delcmd_confirm:")) {
    const [projectName, ...rest] = data.replace("delcmd_confirm:", "").split(":");
    const commandName = rest.join(":");
    const botData = readData();

    if (botData.projects[projectName]?.commands[commandName]) {
      delete botData.projects[projectName].commands[commandName];
      writeData(botData);
      log("COMMAND", `Deleted /${commandName} from ${projectName}`);
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(`✅ Command <code>/${commandName}</code> deleted.`, { parse_mode: "HTML" });
    } else {
      await ctx.answerCallbackQuery();
      await ctx.reply("❌ Command not found");
    }

  } else {
    return next();
  }
});
