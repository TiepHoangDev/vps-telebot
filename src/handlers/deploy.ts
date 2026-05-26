import { exec } from "child_process";
import { promisify } from "util";
import { readData } from "../storage";
import { log } from "../logger";
import { escapeHtml } from "../executor";

const execAsync = promisify(exec);

export async function handleDeployCommand(ctx: any): Promise<void> {
  if (!ctx.from?.id) return;

  const message = ctx.message?.text || "";
  const parts = message.split(/\s+/);

  if (parts.length < 3) {
    await ctx.reply("⛔ Format: /deploy <project> <secret>");
    return;
  }

  const projectName = parts[1];
  const providedSecret = parts[2];
  const data = readData();
  const project = data.projects[projectName];

  if (!project) {
    await ctx.reply("⛔ Project not found");
    return;
  }

  if (!project.deploy_secret || project.deploy_secret !== providedSecret) {
    log("DEPLOY", `Invalid secret attempt for ${projectName}`);
    await ctx.reply("⛔ Invalid secret");
    return;
  }

  const deployCmd = project.commands[`${projectName}_deploy`];
  if (!deployCmd) {
    await ctx.reply(`⛔ No deploy command found for "${projectName}"`);
    return;
  }

  log("DEPLOY", `Triggered for ${projectName}`);
  const ackMsg = await ctx.reply(`⏳ Deploying <b>${projectName}</b>...`, { parse_mode: "HTML" });

  try {
    const { stdout, stderr } = await execAsync(deployCmd, {
      timeout: 300000,
      shell: process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "/bin/sh",
      maxBuffer: 10 * 1024 * 1024,
    });

    const output = stdout || stderr || "Deploy completed";
    const trimmed = output.length > 3800 ? output.substring(0, 3800) + "\n...(truncated)" : output;
    log("DEPLOY", `Success: ${projectName}`);
    await ctx.api.editMessageText(
      ctx.chat.id, ackMsg.message_id,
      `✅ <b>${projectName}</b> deployed\n<pre>${escapeHtml(trimmed)}</pre>`,
      { parse_mode: "HTML" }
    );
  } catch (error: any) {
    let msg = `❌ Deploy failed for <b>${projectName}</b>`;
    if (error.killed) {
      msg += "\nTimed out (5 min)";
    } else {
      const out = error.stdout || error.stderr || error.message || "";
      if (out) msg += `\n<pre>${escapeHtml(out.substring(0, 3800))}</pre>`;
    }
    log("DEPLOY", `Failed: ${projectName} — ${error.message}`);
    await ctx.api.editMessageText(ctx.chat.id, ackMsg.message_id, msg, { parse_mode: "HTML" });
  }
}

