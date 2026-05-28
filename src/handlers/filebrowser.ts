import { Composer, InlineKeyboard, InputFile } from "grammy";
import { BotContext } from "../types";
import { buildProjectView } from "./project";
import { readData, writeData } from "../storage";
import { Project } from "../types";
import { log } from "../logger";
import fs from "fs";
import path from "path";
import os from "os";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const PAGE_SIZE = 50;

export const fileBrowserComposer = new Composer<BotContext>();

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function buildNumberedText(dir: string, items: string[], page: number, totalItems: number): string {
  const totalPages = Math.ceil(totalItems / PAGE_SIZE);
  const lines: string[] = [`📁 <code>${dir}</code>`];
  if (totalPages > 1) lines.push(`Trang ${page + 1}/${totalPages}`);
  lines.push("");
  lines.push("/0 ⬆ ..");
  items.forEach((item, i) => {
    const isDir = item.startsWith("d:");
    const name = item.slice(2);
    lines.push(`/${i + 1} ${isDir ? "📁" : "📄"} ${name}`);
  });
  if (totalPages > 1) {
    lines.push("");
    if (page > 0) lines.push("/prev ⬅ Trang trước");
    if ((page + 1) * PAGE_SIZE < totalItems) lines.push("/next ➡ Trang sau");
  }
  return lines.join("\n");
}

const backKeyboard = new InlineKeyboard().text("← Project", "fb:back");

async function editBrowserMessage(ctx: BotContext, text: string, keyboard?: InlineKeyboard): Promise<void> {
  const opts = { parse_mode: "HTML" as const, reply_markup: keyboard ?? backKeyboard };

  if (ctx.callbackQuery) {
    ctx.session.fbMessageId = ctx.callbackQuery.message?.message_id;
    await ctx.editMessageText(text, opts);
    return;
  }

  const msgId = ctx.session.fbMessageId;
  const chatId = ctx.chat?.id;
  if (msgId && chatId) {
    try {
      await ctx.api.editMessageText(chatId, msgId, text, opts);
      return;
    } catch {}
  }

  const sent = await ctx.reply(text, opts);
  ctx.session.fbMessageId = sent.message_id;
}

async function renderDir(ctx: BotContext, dir: string, page = 0): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err: any) {
    await editBrowserMessage(ctx, `❌ Cannot read directory:\n<code>${err.message}</code>`);
    return;
  }

  const dirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort();
  const files = entries.filter(e => !e.isDirectory()).map(e => e.name).sort();
  const allItems = [...dirs.map(n => `d:${n}`), ...files.map(n => `f:${n}`)];
  const pageItems = allItems.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  ctx.session.fbDir = dir;
  ctx.session.fbAllItems = allItems;
  ctx.session.fbItems = pageItems;
  ctx.session.fbPage = page;
  ctx.session.fbSelected = undefined;

  const text = buildNumberedText(dir, pageItems, page, allItems.length);
  await editBrowserMessage(ctx, text);
}

// Handle /0, /1.../N, /next, /prev navigation commands
fileBrowserComposer.on("message:text", async (ctx, next) => {
  if (!ctx.session.fbDir) return next();

  const text = ctx.message?.text?.trim() ?? "";

  const deleteMsg = async () => {
    try { await ctx.api.deleteMessage(ctx.chat!.id, ctx.message!.message_id); } catch {}
  };

  if (text === "/0") {
    await deleteMsg();
    const cur = ctx.session.fbDir;
    const parent = path.dirname(cur);
    if (parent !== cur) await renderDir(ctx, parent);
    return;
  }

  if (text === "/next") {
    await deleteMsg();
    const allItems = ctx.session.fbAllItems ?? [];
    const page = ctx.session.fbPage ?? 0;
    if ((page + 1) * PAGE_SIZE < allItems.length) await renderDir(ctx, ctx.session.fbDir, page + 1);
    return;
  }

  if (text === "/prev") {
    await deleteMsg();
    const page = ctx.session.fbPage ?? 0;
    if (page > 0) await renderDir(ctx, ctx.session.fbDir, page - 1);
    return;
  }

  if (/^\/\d+$/.test(text)) {
    const idx = parseInt(text.slice(1), 10) - 1;
    const items = ctx.session.fbItems ?? [];
    if (idx < 0 || idx >= items.length) { await deleteMsg(); return; }

    const item = items[idx];
    const isDir = item.startsWith("d:");
    const name = item.slice(2);
    const fullPath = path.join(ctx.session.fbDir, name);
    ctx.session.fbSelected = fullPath;

    await deleteMsg();

    if (isDir) {
      if (ctx.session.fbMode === "addproject") {
        await renderDir(ctx, fullPath);
      } else {
        const keyboard = new InlineKeyboard()
          .text("⬇ Download .tar.gz", "fb:dlzip")
          .text("👁 View", "fb:view")
          .row()
          .text("« Back", "fb:diritems");
        await editBrowserMessage(ctx, `📁 <code>${fullPath}</code>`, keyboard);
      }
    } else if (ctx.session.fbMode === "addproject") {
      if (name !== "docker-compose.yml" && name !== "docker-compose.yaml") {
        await editBrowserMessage(ctx,
          `⚠️ Please select a <code>docker-compose.yml</code> file.\n\n📄 <code>${fullPath}</code>`,
          new InlineKeyboard().text("« Back", "fb:diritems")
        );
      } else {
        const projectName = path.basename(path.dirname(fullPath));
        const keyboard = new InlineKeyboard()
          .text("✅ Add project", "fb:addproject_confirm").row()
          .text("❌ Cancel", "fb:diritems");
        await editBrowserMessage(ctx,
          `➕ Add project <b>${projectName}</b>?\n\n📄 <code>${fullPath}</code>`,
          keyboard
        );
      }
    } else {
      let sizeStr = "";
      try { sizeStr = `  (${formatSize(fs.statSync(fullPath).size)})`; } catch {}
      const keyboard = new InlineKeyboard()
        .text("⬇ Download", "fb:dl")
        .text("🗑 Delete", "fb:delask")
        .row()
        .text("« Back", "fb:diritems");
      await editBrowserMessage(ctx,
        `📄 <code>${path.basename(fullPath)}</code>${sizeStr}\n📁 <code>${path.dirname(fullPath)}</code>`,
        keyboard
      );
    }
    return;
  }

  return next();
});

fileBrowserComposer.on("callback_query:data", async (ctx, next) => {
  const data = ctx.callbackQuery.data;
  if (!data.startsWith("fb:")) return next();

  if (data === "fb:addproject") {
    await ctx.answerCallbackQuery();
    ctx.session.fbMode = "addproject";
    ctx.session.fbProject = undefined;
    const startDir = fs.existsSync("/root") ? "/root" : "/";
    await renderDir(ctx, startDir);
    return;
  }

  if (data === "fb:addproject_confirm") {
    const composePath = ctx.session.fbSelected;
    if (!composePath) { await ctx.answerCallbackQuery(); return; }

    const projectName = path.basename(path.dirname(composePath));
    const botData = readData();

    if (botData.projects[projectName]) {
      await ctx.answerCallbackQuery();
      const keyboard = new InlineKeyboard().text("« Back", "fb:diritems");
      await ctx.editMessageText(
        `⚠️ Project <b>${projectName}</b> already exists. Delete it first or rename manually in data.json.`,
        { parse_mode: "HTML", reply_markup: keyboard }
      );
      return;
    }

    const commands: Record<string, Record<string, string>> = {
      Docker: {
        [`${projectName}_up`]:     `docker compose -f ${composePath} up -d`,
        [`${projectName}_down`]:   `docker compose -f ${composePath} down`,
        [`${projectName}_downv`]:  `docker compose -f ${composePath} down -v`,
        [`${projectName}_logs`]:   `docker compose -f ${composePath} logs --tail=1000`,
        [`${projectName}_pull`]:   `docker compose -f ${composePath} pull`,
        [`${projectName}_deploy`]: `docker compose -f ${composePath} pull && docker compose -f ${composePath} up -d --force-recreate`,
      },
    };
    const project: Project = { path: composePath, commands };
    botData.projects[projectName] = project;
    writeData(botData);
    log("PROJECT", `Added: ${projectName}`);

    ctx.session.fbMode = undefined;
    ctx.session.fbDir = undefined;
    ctx.session.fbItems = undefined;
    ctx.session.fbAllItems = undefined;
    ctx.session.fbPage = undefined;
    ctx.session.fbSelected = undefined;
    ctx.session.fbMessageId = undefined;

    await ctx.answerCallbackQuery("✅ Project added!");
    await ctx.editMessageText(
      `✅ Project <b>${projectName}</b> added!\n📄 <code>${composePath}</code>`,
      { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("« Back to menu", "list_back") }
    );
    return;
  }

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
    ctx.session.fbAllItems = undefined;
    ctx.session.fbPage = undefined;
    ctx.session.fbSelected = undefined;
    ctx.session.fbMessageId = undefined;
    ctx.session.fbMode = undefined;
    await ctx.answerCallbackQuery();
    if (!projectName) return;
    const view = buildProjectView(projectName);
    if (view) await ctx.editMessageText(view.text, { parse_mode: "HTML", reply_markup: view.keyboard });
    return;
  }

  await ctx.answerCallbackQuery();
});
