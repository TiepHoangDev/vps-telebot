import { Middleware, Context } from "grammy";
import { readData, writeData } from "../storage";
import { log } from "../logger";

const SETUP_PASS = process.env.SETUP_PASS;

export const authMiddleware: Middleware<any> = async (ctx, next) => {
  const userId = ctx.from?.id;

  if (!userId) {
    return;
  }

  const data = readData();

  if (data.allowed_users.length === 0) {
    if (!SETUP_PASS) {
      data.allowed_users.push(userId);
      writeData(data);
      await ctx.reply("✅ You are now the owner. No SETUP_PASS was set.");
      await next();
      return;
    }

    const text = ctx.message?.text?.trim();
    if (text === SETUP_PASS) {
      data.allowed_users.push(userId);
      writeData(data);
      log("AUTH", `New owner added: ${userId}`);
      await ctx.reply("✅ Password correct. You are now the owner.");
      await next();
    } else {
      await ctx.reply("🔐 Bot not set up yet. Send the setup password to become owner.");
    }
    return;
  }

  if (data.allowed_users.includes(userId)) {
    await next();
  } else {
    log("AUTH", `Unauthorized access attempt: ${userId}`);
    await ctx.reply("⛔ Unauthorized");
  }
};
