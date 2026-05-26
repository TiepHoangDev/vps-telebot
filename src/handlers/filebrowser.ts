import { Composer, InlineKeyboard, InputFile } from "grammy";
import { BotContext } from "../types";
import { buildProjectView } from "./project";
import { readData } from "../storage";
import { log } from "../logger";
import fs from "fs";
import path from "path";
import os from "os";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export const fileBrowserComposer = new Composer<BotContext>();

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function buildListingText(dir: string, items: string[], total: number): string {
  const lines: string[] = [`📁 <code>${dir}</code>`, ""];
  lines.push("|-⬆ ..");
  items.forEach(item => {
    const isDir = item.startsWith("d:");
    const name = item.slice(2);
    lines.push(`|-${isDir ? "📁" : "📄"} ${name}`);
  });
  if (total > items.length) lines.push(`|- … ${total - items.length} more not shown`);
  return lines.join("\n");
}

function buildListingKeyboard(items: string[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  keyboard.text("⬆ ..", "fb:up").row();
  items.forEach((item, i) => {
    const isDir = item.startsWith("d:");
    const name = item.slice(2);
    const label = isDir ? `📁 ${name}` : `📄 ${name}`;
    keyboard.text(label, `fb:i:${i}`);
    if (i % 2 === 1) keyboard.row();
  });
  if (items.length % 2 !== 0) keyboard.row();
  keyboard.text("← Project", "fb:back");
  return keyboard;
}

async function renderDir(ctx: any, dir: string): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err: any) {
    await ctx.editMessageText(`❌ Cannot read directory:\n<code>${err.message}</code>`, { parse_mode: "HTML" });
    return;
  }

  const dirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort();
  const files = entries.filter(e => !e.isDirectory()).map(e => e.name).sort();
  const allItems = [...dirs.map(n => `d:${n}`), ...files.map(n => `f:${n}`)];
  const shown = allItems.slice(0, 40);

  ctx.session.fbDir = dir;
  ctx.session.fbItems = shown;
  ctx.session.fbSelected = undefined;

  const text = buildListingText(dir, shown, allItems.length);
  const keyboard = buildListingKeyboard(shown);
  await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: keyboard });
}

fileBrowserComposer.on("callback_query:data", async (ctx, next) => {
  const data = ctx.callbackQuery.data;

  if (!data.startsWith("fb:")) return next();

  if (data.startsWith("fb:open:")) {
    const projectName = data.replace("fb:open:", "");
    const botData = readData();
    const project = botData.projects[projectName];
    if (!project) { await ctx.answerCallbackQuery("Project not found"); return; }
    ctx.session.fbProject = projectName;
    await ctx.answerCallbackQuery();
    await renderDir(ctx, path.dirname(project.path));
    return;
  }

  if (data === "fb:up") {
    const cur = ctx.session.fbDir ?? "/";
    const parent = path.dirname(cur);
    await ctx.answerCallbackQuery();
    await renderDir(ctx, parent);
    return;
  }

  if (data.startsWith("fb:i:")) {
    const idx = parseInt(data.replace("fb:i:", ""), 10);
    const items = ctx.session.fbItems ?? [];
    const item = items[idx];
    if (!item) { await ctx.answerCallbackQuery("Item not found"); return; }

    const isDir = item.startsWith("d:");
    const name = item.slice(2);
    const fullPath = path.join(ctx.session.fbDir ?? "/", name);
    ctx.session.fbSelected = fullPath;
    await ctx.answerCallbackQuery();

    if (isDir) {
      const keyboard = new InlineKeyboard()
        .text("⬇ Download .tar.gz", "fb:dlzip")
        .text("👁 View", "fb:view")
        .row()
        .text("« Back", "fb:diritems");
      await ctx.editMessageText(
        `📁 <code>${fullPath}</code>`,
        { parse_mode: "HTML", reply_markup: keyboard }
      );
    } else {
      let sizeStr = "";
      try { sizeStr = `  (${formatSize(fs.statSync(fullPath).size)})`; } catch {}
      const keyboard = new InlineKeyboard()
        .text("⬇ Download", "fb:dl")
        .text("🗑 Delete", "fb:delask")
        .row()
        .text("« Back", "fb:diritems");
      await ctx.editMessageText(
        `📄 <code>${path.basename(fullPath)}</code>${sizeStr}\n📁 <code>${path.dirname(fullPath)}</code>`,
        { parse_mode: "HTML", reply_markup: keyboard }
      );
    }
    return;
  }

  if (data === "fb:view") {
    const target = ctx.session.fbSelected;
    if (!target) { await ctx.answerCallbackQuery(); return; }
    await ctx.answerCallbackQuery();
    await renderDir(ctx, target);
    return;
  }

  if (data === "fb:diritems") {
    await ctx.answerCallbackQuery();
    await renderDir(ctx, ctx.session.fbDir ?? "/");
    return;
  }

  if (data === "fb:dl") {
    const filePath = ctx.session.fbSelected;
    if (!filePath) { await ctx.answerCallbackQuery("No file selected"); return; }
    await ctx.answerCallbackQuery("⬇ Sending...");
    try {
      await ctx.replyWithDocument(new InputFile(filePath, path.basename(filePath)));
      log("FB", `Downloaded ${filePath}`);
    } catch (err: any) {
      await ctx.reply(`❌ Failed: ${err.message}`);
    }
    return;
  }

  if (data === "fb:dlzip") {
    const dirPath = ctx.session.fbSelected;
    if (!dirPath) { await ctx.answerCallbackQuery("No folder selected"); return; }
    await ctx.answerCallbackQuery("⏳ Creating archive...");
    const tmpFile = path.join(os.tmpdir(), `fb_${Date.now()}.tar.gz`);
    try {
      await execAsync(
        `tar -czf "${tmpFile}" -C "${path.dirname(dirPath)}" "${path.basename(dirPath)}"`,
        { timeout: 60000 }
      );
      await ctx.replyWithDocument(new InputFile(tmpFile, `${path.basename(dirPath)}.tar.gz`));
      log("FB", `Downloaded zip ${dirPath}`);
    } catch (err: any) {
      await ctx.reply(`❌ Failed to create archive: ${err.message}`);
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
    return;
  }

  if (data === "fb:delask") {
    const target = ctx.session.fbSelected;
    if (!target) { await ctx.answerCallbackQuery(); return; }
    const keyboard = new InlineKeyboard()
      .text("✅ Yes, delete", "fb:delok")
      .text("❌ Cancel", "fb:diritems");
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      `🗑 Delete <code>${path.basename(target)}</code>?\n\nThis cannot be undone.`,
      { parse_mode: "HTML", reply_markup: keyboard }
    );
    return;
  }

  if (data === "fb:delok") {
    const target = ctx.session.fbSelected;
    if (!target) { await ctx.answerCallbackQuery(); return; }
    try {
      fs.unlinkSync(target);
      log("FB", `Deleted ${target}`);
      ctx.session.fbSelected = undefined;
      await ctx.answerCallbackQuery("Deleted ✅");
      await renderDir(ctx, ctx.session.fbDir ?? path.dirname(target));
    } catch (err: any) {
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(`❌ Delete failed: ${err.message}`, { parse_mode: "HTML" });
    }
    return;
  }

  if (data === "fb:back") {
    const projectName = ctx.session.fbProject;
    ctx.session.fbDir = undefined;
    ctx.session.fbItems = undefined;
    ctx.session.fbSelected = undefined;
    await ctx.answerCallbackQuery();
    if (!projectName) return;
    const view = buildProjectView(projectName);
    if (view) await ctx.editMessageText(view.text, { parse_mode: "HTML", reply_markup: view.keyboard });
    return;
  }

  await ctx.answerCallbackQuery();
});
