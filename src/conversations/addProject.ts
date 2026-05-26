import { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { Conversation } from "@grammyjs/conversations";
import * as path from "path";
import { readData, writeData } from "../storage";
import { Project } from "../types";
import { cmdLabel } from "../executor";
import { log } from "../logger";

export async function addProjectConversation(
  conversation: Conversation<Context>,
  ctx: Context
): Promise<void> {
  await ctx.reply("Enter path to docker-compose.yml:");

  const response = await conversation.waitFor("message:text");
  const dockerComposePath = response.msg.text.trim();

  let projectName = path.basename(path.dirname(dockerComposePath));

  const data = readData();
  if (data.projects[projectName]) {
    await ctx.reply(`Project "${projectName}" already exists. Enter a different name:`);
    const nameResponse = await conversation.waitFor("message:text");
    const newName = nameResponse.msg.text.trim();
    if (!newName || data.projects[newName]) {
      await ctx.reply("❌ Name already exists or invalid. Cancelled.");
      return;
    }
    projectName = newName;
  }

  const commands: Record<string, Record<string, string>> = {
    Docker: {
      [`${projectName}_up`]:     `docker compose -f ${dockerComposePath} up -d`,
      [`${projectName}_down`]:   `docker compose -f ${dockerComposePath} down`,
      [`${projectName}_downv`]:  `docker compose -f ${dockerComposePath} down -v`,
      [`${projectName}_logs`]:   `docker compose -f ${dockerComposePath} logs --tail=1000`,
      [`${projectName}_pull`]:   `docker compose -f ${dockerComposePath} pull`,
      [`${projectName}_deploy`]: `docker compose -f ${dockerComposePath} pull && docker compose -f ${dockerComposePath} up -d`,
    },
  };

  const project: Project = { path: dockerComposePath, commands };
  data.projects[projectName] = project;
  writeData(data);
  log("PROJECT", `Added: ${projectName}`);

  // Show created commands as clickable buttons
  const keyboard = new InlineKeyboard();
  const dockerCmds = Object.keys(commands.Docker);
  dockerCmds.forEach((cmd, i) => {
    keyboard.text(cmdLabel(cmd), `run_cmd:${cmd}`);
    if ((i + 1) % 3 === 0) keyboard.row();
  });

  await ctx.reply(
    `✅ Project <b>${projectName}</b> created. Click to run:`,
    { parse_mode: "HTML", reply_markup: keyboard }
  );
}
