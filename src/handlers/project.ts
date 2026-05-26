import { Composer, InputFile, InlineKeyboard } from "grammy";
import { BotContext } from "../types";
import { readData, writeData, findCommand, groupLabel } from "../storage";
import { generateSecret } from "../utils";
import { log } from "../logger";
import { runCommand, escapeHtml, cmdLabel } from "../executor";
import { handleVpsCommand } from "./vps";

export const projectComposer = new Composer<BotContext>();

projectComposer.command("addproject", async (ctx) => {
  await ctx.conversation.enter("addProject");
});

export function buildProjectView(projectName: string) {
  const data = readData();
  const project = data.projects[projectName];
  if (!project) return null;

  const secretLine = project.deploy_secret
    ? `\n🔑 Secret: <code>${project.deploy_secret}</code>`
    : "";
  const text = `📁 <b>${projectName}</b>\nPath: <code>${project.path}</code>${secretLine}`;

  const keyboard = new InlineKeyboard();

  // One button per group — always include Custom as entry point for adding cmds
  const groups = new Set([...Object.keys(project.commands), "Custom"]);
  groups.forEach(g => {
    const count = project.commands[g] ? Object.keys(project.commands[g]).length : 0;
    const label = count > 0 ? `${groupLabel(g)}  (${count})` : groupLabel(g);
    keyboard.text(label, `proj_group:${projectName}:${g}`).row();
  });

  keyboard
    .text("📤 Send File", `proj_sendfile:${projectName}`)
    .text("📂 Browse", `fb:open:${projectName}`)
    .row()
    .text("🔑 Deploy Secret", `proj_secret:${projectName}`)
    .row()
    .text("🗑 Delete Project", `proj_delete:${projectName}`)
    .row()
    .text("« Back", "list_back");

  return { text, keyboard };
}

function buildGroupView(projectName: string, groupName: string) {
  const data = readData();
  const project = data.projects[projectName];
  if (!project) return null;

  const cmds = project.commands[groupName] ?? {};
  const cmdNames = Object.keys(cmds);
  const text = cmdNames.length === 0
    ? `📁 <b>${projectName}</b> › ${groupLabel(groupName)}\n<i>No commands yet.</i>`
    : `📁 <b>${projectName}</b> › ${groupLabel(groupName)}`;

  const keyboard = new InlineKeyboard();

  cmdNames.forEach((cmd, i) => {
    keyboard.text(cmdLabel(cmd), `run_cmd:${cmd}`);
    if ((i + 1) % 3 === 0) keyboard.row();
  });
  if (cmdNames.length % 3 !== 0 || cmdNames.length === 0) keyboard.row();

  if (groupName === "Custom") {
    keyboard.text("➕ Add Cmd", `proj_addcmd:${projectName}`);
    if (cmdNames.length > 0) keyboard.text("🗑 Del Cmd", `delcmd_project:${projectName}`);
    keyboard.row();
  }

  keyboard.text("« Back", `list_project:${projectName}`);
  return { text, keyboard };
}

projectComposer.on("callback_query:data", async (ctx, next) => {
  const data = ctx.callbackQuery.data;

  if (data.startsWith("run_cmd:")) {
    const commandName = data.replace("run_cmd:", "");
    const botData = readData();
    let shellCommand: string | null = null;
    for (const p of Object.values(botData.projects)) {
      shellCommand = findCommand(p, commandName);
      if (shellCommand) break;
    }
    if (!shellCommand) {
      await ctx.answerCallbackQuery("Command not found");
      return;
    }
    await ctx.answerCallbackQuery(`⏳ Running...`);
    const ackMsg = await ctx.reply(`⏳ Running <code>/${commandName}</code>...`, { parse_mode: "HTML" });

    await runCommand(commandName, shellCommand, async () => {
      const editFn = async (text: string) => {
        try {
          await ctx.api.editMessageText(ctx.chat!.id, ackMsg.message_id, text, { parse_mode: "HTML" });
        } catch {
          await ctx.reply(text, { parse_mode: "HTML" });
        }
      };
      const sendFileFn = async (buf: Buffer, name: string) => {
        await ctx.replyWithDocument(new InputFile(buf, name));
      };
      return { chatId: ctx.chat!.id, messageId: ackMsg.message_id, editFn, sendFileFn };
    });

  } else if (data.startsWith("proj_group:")) {
    const rest = data.slice("proj_group:".length);
    const sep = rest.indexOf(":");
    const projectName = rest.slice(0, sep);
    const groupName = rest.slice(sep + 1);
    const view = buildGroupView(projectName, groupName);
    if (!view) { await ctx.answerCallbackQuery("Project not found"); return; }
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(view.text, { parse_mode: "HTML", reply_markup: view.keyboard });

  } else if (data.startsWith("list_project:")) {
    const projectName = data.replace("list_project:", "");
    ctx.session.awaitingInput = undefined;
    ctx.session.pendingProject = undefined;
    ctx.session.pendingCmdSuffix = undefined;
    const view = buildProjectView(projectName);
    if (!view) { await ctx.answerCallbackQuery("Project not found"); return; }
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(view.text, { parse_mode: "HTML", reply_markup: view.keyboard });

  } else if (data === "list_back") {
    ctx.session.awaitingInput = undefined;
    ctx.session.pendingProject = undefined;
    ctx.session.pendingCmdSuffix = undefined;
    const botData = readData();
    const keyboard = new InlineKeyboard();
    Object.keys(botData.projects).forEach(name =>
      keyboard.text(`📁 ${name}`, `list_project:${name}`).row()
    );
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("📋 Projects — click to manage:", { reply_markup: keyboard });

  } else if (data.startsWith("proj_addcmd:")) {
    const projectName = data.replace("proj_addcmd:", "");
    ctx.session.pendingProject = projectName;
    ctx.session.awaitingInput = "cmd_suffix";
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `Adding command to <b>${projectName}</b>\nEnter command suffix — will be saved as <code>${projectName}_suffix</code>:\n(type /cancel to abort)`,
      { parse_mode: "HTML" }
    );

  } else if (data.startsWith("proj_sendfile:")) {
    const projectName = data.replace("proj_sendfile:", "");
    ctx.session.pendingProject = projectName;
    ctx.session.awaitingInput = "send_file";
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `📤 Send files for project <b>${projectName}</b>.\nFiles will be saved to the project directory.\n\nType anything to cancel.`,
      { parse_mode: "HTML" }
    );

  } else if (data.startsWith("proj_secret:")) {
    const projectName = data.replace("proj_secret:", "");
    const botData = readData();
    if (!botData.projects[projectName]) { await ctx.answerCallbackQuery("Not found"); return; }

    const secret = generateSecret();
    botData.projects[projectName].deploy_secret = secret;
    writeData(botData);
    log("DEPLOY_SECRET", `Generated for ${projectName}`);

    const snippet =
      `- name: Trigger deploy\n` +
      `  run: |\n` +
      `    curl -s "https://api.telegram.org/bot\${{ secrets.BOT_TOKEN }}/sendMessage" \\\n` +
      `      -d "chat_id=\${{ secrets.CHAT_ID }}" \\\n` +
      `      -d "text=/deploy ${projectName} ${secret}"`;

    await ctx.answerCallbackQuery("Secret generated!");
    await ctx.reply(
      `🔑 Deploy secret for <b>${projectName}</b>:\n\n<code>${secret}</code>\n\n<b>GitHub Actions:</b>\n<pre>${escapeHtml(snippet)}</pre>`,
      { parse_mode: "HTML" }
    );
    const view = buildProjectView(projectName);
    if (view) await ctx.reply(view.text, { parse_mode: "HTML", reply_markup: view.keyboard });

  } else if (data.startsWith("proj_delete:")) {
    const projectName = data.replace("proj_delete:", "");
    const confirmKeyboard = new InlineKeyboard()
      .text("Yes, delete", `confirm_del:${projectName}`)
      .text("Cancel", "cancel_del");
    await ctx.answerCallbackQuery();
    await ctx.reply(`Delete project <b>${projectName}</b>?`, {
      parse_mode: "HTML", reply_markup: confirmKeyboard,
    });

  } else if (data.startsWith("confirm_del:")) {
    const projectName = data.replace("confirm_del:", "");
    const botData = readData();
    if (botData.projects[projectName]) {
      delete botData.projects[projectName];
      writeData(botData);
      log("PROJECT", `Deleted: ${projectName}`);
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(`✅ Project <b>${projectName}</b> deleted.`, { parse_mode: "HTML" });
    } else {
      await ctx.answerCallbackQuery();
      await ctx.reply("❌ Project not found");
    }

  } else if (data === "cancel_del") {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("Cancelled.");

  } else if (data === "help_addproject") {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("addProject");

  } else if (data === "help_vps") {
    await ctx.answerCallbackQuery();
    await handleVpsCommand(ctx);

  } else {
    return next();
  }
});
