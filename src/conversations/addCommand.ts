import { Context } from "grammy";
import { Conversation } from "@grammyjs/conversations";
import { InlineKeyboard } from "grammy";
import { readData, writeData } from "../storage";
import { log } from "../logger";

export async function addCommandConversation(
  conversation: Conversation<Context>,
  ctx: Context
): Promise<void> {
  const data = readData();
  const projectNames = Object.keys(data.projects);

  if (projectNames.length === 0) {
    await ctx.reply("❌ No projects configured. Use /addproject first.");
    return;
  }

  // Check if project was pre-selected (from project view button)
  let selectedProject: string = (ctx as any).session?.selectedProject || "";

  if (!selectedProject) {
    const keyboard = new InlineKeyboard();
    projectNames.forEach(name => keyboard.text(name, `addcmd_proj:${name}`).row());
    await ctx.reply("Select a project:", { reply_markup: keyboard });

    const response = await conversation.waitFor("callback_query");
    selectedProject = (response.callbackQuery?.data || "").replace("addcmd_proj:", "");
    await response.answerCallbackQuery();
  } else {
    await ctx.reply(`Adding command to project <b>${selectedProject}</b>`, { parse_mode: "HTML" });
    // Clear pre-selection
    (ctx as any).session.selectedProject = undefined;
  }

  await ctx.reply(
    `Enter command suffix — will be saved as <code>/${selectedProject}_suffix</code>:`,
    { parse_mode: "HTML" }
  );

  const nameResponse = await conversation.waitFor("message:text");
  const suffix = nameResponse.msg.text.trim().replace(/\s+/g, "_");
  const commandName = `${selectedProject}_${suffix}`;

  await ctx.reply(`Enter the shell command for <code>/${commandName}</code>:`, { parse_mode: "HTML" });

  const cmdResponse = await conversation.waitFor("message:text");
  const shellCommand = cmdResponse.msg.text.trim();

  const updatedData = readData();
  if (updatedData.projects[selectedProject]) {
    updatedData.projects[selectedProject].commands[commandName] = shellCommand;
    writeData(updatedData);
    log("COMMAND", `Added /${commandName} to ${selectedProject}`);
    await ctx.reply(`✅ Command <code>/${commandName}</code> saved!`, { parse_mode: "HTML" });
  } else {
    await ctx.reply("❌ Project not found. Cancelled.");
  }
}
