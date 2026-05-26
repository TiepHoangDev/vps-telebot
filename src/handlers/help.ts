import { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { readData } from "../storage";
import { version } from "../../package.json";

export async function handleHelp(ctx: Context): Promise<void> {
  const data = readData();
  const projectNames = Object.keys(data.projects);

  const systemKeyboard = new InlineKeyboard()
    .text("➕ Add Project", "help_addproject").row()
    .text("📊 VPS Status", "help_vps").row();

  await ctx.reply(`<b>VPS Telebot</b>  <code>v${version}</code>`, {
    parse_mode: "HTML",
    reply_markup: systemKeyboard,
  });

  if (projectNames.length === 0) {
    await ctx.reply("No projects yet. Click ➕ Add Project to get started.");
    return;
  }

  const keyboard = new InlineKeyboard();
  projectNames.forEach(name => keyboard.text(`📁 ${name}`, `list_project:${name}`).row());
  await ctx.reply("📋 Projects — click to manage:", { reply_markup: keyboard });
}
