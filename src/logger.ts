export function log(tag: string, msg: string) {
  const ts = new Date().toISOString().replace("T", " ").split(".")[0];
  console.log(`[${ts}] [${tag}] ${msg}`);
}
