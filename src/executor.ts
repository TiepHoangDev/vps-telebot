import { exec } from "child_process";
import { promisify } from "util";
import { log } from "./logger";

const execAsync = promisify(exec);

const SHELL = process.platform === "win32"
  ? (process.env.ComSpec || "cmd.exe")
  : "/bin/sh";

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

  try {
    const { stdout, stderr } = await execAsync(shellCommand, {
      timeout,
      shell: SHELL,
      maxBuffer: 10 * 1024 * 1024,
    });

    const output = stdout || stderr || "(no output)";
    if (isLogs) {
      log("RUN", `/${commandName} done (file)`);
      await editFn(`✅ <code>/${commandName}</code>`);
      await sendFileFn(Buffer.from(output), `${commandName}.log`);
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
