import { Context } from "grammy";
import * as os from "os";
import * as si from "systeminformation";

export async function handleVpsCommand(ctx: any): Promise<void> {
  try {
    const [cpuData, currentLoad, memData, diskData, osInfo] = await Promise.all([
      si.cpu(),
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
      si.osInfo(),
    ]);

    const cpuUsage = Math.round(currentLoad.currentLoad);
    const cpuCores = cpuData.cores;

    const ramUsedGb = (memData.used / (1024 ** 3)).toFixed(1);
    const ramTotalGb = (memData.total / (1024 ** 3)).toFixed(1);
    const ramPercent = Math.round((memData.used / memData.total) * 100);

    let diskLine = "";
    if (diskData.length > 0) {
      const d = diskData[0];
      const used = (d.used / (1024 ** 3)).toFixed(0);
      const total = (d.size / (1024 ** 3)).toFixed(0);
      const pct = Math.round((d.used / d.size) * 100);
      diskLine = `\nDisk:   ${used} GB / ${total} GB (${pct}%)  [${d.mount}]`;
    }

    const uptimeSec = os.uptime();
    const days = Math.floor(uptimeSec / 86400);
    const hours = Math.floor((uptimeSec % 86400) / 3600);
    const mins = Math.floor((uptimeSec % 3600) / 60);
    const uptimeStr = `${days}d ${hours}h ${mins}m`;

    const loadAvg = os.loadavg();
    const loadStr = loadAvg.map(l => l.toFixed(2)).join(" / ");

    const osLine = `${osInfo.distro} ${osInfo.release} (${osInfo.arch})`;

    await ctx.reply(
      `📊 <b>VPS Status</b>\n──────────────\n` +
      `OS:     ${osLine}\n` +
      `CPU:    ${cpuUsage}% (${cpuCores} cores)\n` +
      `RAM:    ${ramUsedGb} GB / ${ramTotalGb} GB (${ramPercent}%)` +
      diskLine + "\n" +
      `Uptime: ${uptimeStr}\n` +
      `Load:   ${loadStr}`,
      { parse_mode: "HTML" }
    );
  } catch (error) {
    console.error("Error getting VPS stats:", error);
    await ctx.reply("❌ Failed to retrieve VPS stats");
  }
}
