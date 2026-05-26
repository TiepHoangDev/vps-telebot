import { Middleware } from "grammy";
import { readData, writeData } from "../storage";
import { log } from "../logger";
import https from "https";
import fs from "fs";
import path from "path";

async function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
    } catch (e) {
      reject(e);
      return;
    }
    const stream = fs.createWriteStream(dest);
    stream.on("error", (err) => {
      stream.destroy();
      fs.unlink(dest, () => {});
      reject(err);
    });
    https.get(url, (res) => {
      res.pipe(stream);
      stream.on("finish", () => { stream.close(); resolve(); });
    }).on("error", (err) => {
      stream.destroy();
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

export const inputMiddleware: Middleware<any> = async (ctx, next) => {
  const session = ctx.session as any;
  if (!session?.awaitingInput) return next();

  const text: string | undefined = ctx.message?.text;
  const document = ctx.message?.document;

  if (session.awaitingInput === "send_file" && ctx.message?.photo) {
    await ctx.reply("Please send the file as a document — tap 📎 → File, not Photo.");
    return;
  }

  if (!text && !document) return next();

  const awaitingInput: string = session.awaitingInput;

  if (awaitingInput === "cmd_suffix") {
    if (text === "/cancel") {
      session.awaitingInput = undefined;
      session.pendingProject = undefined;
      await ctx.reply("Cancelled.");
      return;
    }
    if (!text) return next();
    const suffix = text.trim().replace(/[^a-zA-Z0-9_]/g, "_").replace(/^_+|_+$/g, "");
    if (!suffix) {
      await ctx.reply("❌ Invalid suffix. Use letters, numbers, underscores only.");
      return;
    }
    const projectName: string = session.pendingProject;
    session.pendingCmdSuffix = suffix;
    session.awaitingInput = "cmd_shell";
    await ctx.reply(
      `Enter the shell command for <code>${projectName}_${suffix}</code>:\n(type /cancel to abort)`,
      { parse_mode: "HTML" }
    );
    return;
  }

  if (awaitingInput === "cmd_shell") {
    if (text === "/cancel") {
      session.awaitingInput = undefined;
      session.pendingProject = undefined;
      session.pendingCmdSuffix = undefined;
      await ctx.reply("Cancelled.");
      return;
    }
    if (!text) return next();
    const shellCommand = text.trim();
    const projectName: string = session.pendingProject;
    const suffix: string = session.pendingCmdSuffix;
    const commandName = `${projectName}_${suffix}`;

    const data = readData();
    const project = data.projects[projectName];
    if (project) {
      if (!project.commands["Custom"]) project.commands["Custom"] = {};
      project.commands["Custom"][commandName] = shellCommand;
      writeData(data);
      log("COMMAND", `Added ${commandName}`);
      await ctx.reply(`✅ Command <code>/${commandName}</code> saved!`, { parse_mode: "HTML" });
    } else {
      await ctx.reply("❌ Project not found.");
    }
    session.awaitingInput = undefined;
    session.pendingProject = undefined;
    session.pendingCmdSuffix = undefined;
    return;
  }

  if (awaitingInput === "send_file") {
    if (text) {
      session.awaitingInput = undefined;
      session.pendingProject = undefined;
      await ctx.reply("File upload cancelled.");
      return;
    }
    if (!document) {
      await ctx.reply("Please send a file, or type anything to cancel.");
      return;
    }
    const projectName: string = session.pendingProject;
    const data = readData();
    const project = data.projects[projectName];
    if (!project) {
      session.awaitingInput = undefined;
      await ctx.reply("❌ Project not found.");
      return;
    }
    const projectDir = path.dirname(project.path);
    const fileName = document.file_name || `upload_${Date.now()}`;
    const destPath = path.join(projectDir, fileName);
    try {
      const file = await ctx.api.getFile(document.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
      await downloadFile(fileUrl, destPath);
      log("FILE", `Saved ${fileName} to ${projectDir}`);
      await ctx.reply(
        `✅ Saved <code>${fileName}</code> to <code>${projectDir}</code>\n\nSend another file, or type anything to finish.`,
        { parse_mode: "HTML" }
      );
    } catch (err: any) {
      await ctx.reply(`❌ Failed to save: ${err.message}`);
      session.awaitingInput = undefined;
      session.pendingProject = undefined;
    }
    return;
  }

  return next();
};
