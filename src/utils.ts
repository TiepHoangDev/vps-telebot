/**
 * Generate a secret in the format xxxx-xxxx-xxxx
 * where each x is a random lowercase alphanumeric character (a-z, 0-9)
 */
export function generateSecret(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const segment = () => {
    let result = "";
    for (let i = 0; i < 4; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };
  return `${segment()}-${segment()}-${segment()}`;
}
