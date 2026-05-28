import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import { log } from "./logger";

const execAsync = promisify(exec);

const SHELL = process.platform === "win32"
  ? (process.env.ComSpec || "cmd.exe")
  : "/bin/sh";

const INSIDE_DOCKER = fs.existsSync("/.dockerenv");

// Cached compose file path of the bot's own container (from docker labels)
let _selfComposePath: string | undefined;

async function getSelfComposePath(): Promise<string> {
  if (_selfComposePath !== undefined) return _selfComposePath;
  try {
    const { stdout } = await execAsync(
      `docker inspect $(hostname) --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}'`,
      { shell: "/bin/sh" }
    );
    _selfComposePath = stdout.trim();
  } catch {
    _selfComposePath = "";
  }
  return _selfComposePath;
}

export async function isSelfDeploy(shellCommand: string): Promise<boolean> {
  if (!INSIDE_DOCKER) return false;
  const composePath = await getSelfComposePath();
  return composePath.length > 0 && shellCommand.includes(composePath);
}

async function getSelfImage(): Promise<string> {
  const { stdout } = await execAsync(`docker inspect $(hostname) --format '{{.Config.Image}}'`, { shell: "/bin/sh" });
  return stdout.trim();
}

export async function spawnSiblingDeploy(shellCommand: string): Promise<void> {
  const image = await getSelfImage();
  const escaped = shellCommand.replace(/'/g, `'\\''`);
  const cmd = `docker run --rm -d -v /var/run/docker.sock:/var/run/docker.sock -v /root:/root ${image} sh -c 'sleep 3 && ${escaped}'`;
  await execAsync(cmd);
}

type RunCallbacks = {
  chatId: number;
  messageId: number;
  editFn: (text: string) => Promise<void>;
  sendFileFn: (buf: Buffer, name: string) => Promise<void>;
};

export async function runCommand(
  commandName: string,
  shellCommand: string,
  onStart: () => Promise<RunCallbacks>
): Promise<void> {
  const { editFn, sendFileFn } = await onStart();

  const isLogs = commandName.includes("logs");
  const timeout = isLogs ? 300000 : 60000;

  log("RUN", `/${commandName}`);

  const isDeployCmd = commandName.endsWith("_deploy");
  if (isDeployCmd && await isSelfDeploy(shellCommand)) {
    await spawnSiblingDeploy(shellCommand);
    log("RUN", `/${commandName} queued via sibling`);
    await editFn(`🔄 <code>/${commandName}</code> queued — bot will restart shortly...`);
    return;
  }

  try {
    const { stdout, stderr } = await execAsync(shellCommand, {
      timeout,
      shell: SHELL,
      maxBuffer: 10 * 1024 * 1024,
    });

    const output = stdout || stderr || "(no output)";
    if (isLogs) {
      const MAX_SIZE = 5 * 1024 * 1024;
      let buf = Buffer.from(output);
      let truncated = false;
      if (buf.length > MAX_SIZE) {
        buf = buf.slice(buf.length - MAX_SIZE);
        const nl = buf.indexOf(10);
        if (nl > 0) buf = buf.slice(nl + 1);
        truncated = true;
      }
      log("RUN", `/${commandName} done (file)`);
      await editFn(`✅ <code>/${commandName}</code>${truncated ? " (last 5 MB)" : ""}`);
      await sendFileFn(buf, `${commandName}.txt`);
    } else {
      const trimmed = output.length > 3800 ? output.substring(0, 3800) + "\n...(truncated)" : output;
      log("RUN", `/${commandName} done`);
      await editFn(`✅ <code>/${commandName}</code>\n<pre>${escapeHtml(trimmed)}</pre>`);
    }
  } catch (error: any) {
    let msg = `❌ <code>/${commandName}</code> failed`;
    if (error.killed) {
      msg += "\nTimed out";
    } else {
      const out = error.stdout || error.stderr || error.message || "";
      if (out) msg += `\n<pre>${escapeHtml(out.substring(0, 3800))}</pre>`;
    }
    log("RUN", `/${commandName} error: ${error.message}`);
    await editFn(msg);
  }
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c] ?? c)
  );
}

const CMD_LABELS: Record<string, string> = {
  up: "▶ up", down: "⏹ down", downv: "⏹ down -v",
  logs: "📋 logs", pull: "⬇ pull", deploy: "🚀 deploy",
};

export function cmdLabel(commandName: string): string {
  const suffix = commandName.split("_").slice(1).join("_");
  return CMD_LABELS[suffix] ?? commandName;
}
