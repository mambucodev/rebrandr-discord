import path from "path";

function parseAdminUserIds(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;\s]+/)
    .map((id) => id.replace(/['"]/g, "").trim())
    .filter((id) => id.length > 0);
}

export const config = {
  token: process.env.DISCORD_TOKEN || "",
  guildId: process.env.GUILD_ID || "",
  dbPath: process.env.DATABASE_PATH || path.resolve(process.cwd(), "data", "rebrand.sqlite"),
  iconsDir: process.env.ICONS_DIR || path.resolve(process.cwd(), "data", "icons"),
  port: parseInt(process.env.PORT || "3000", 10),
  enableHealthServer: process.env.ENABLE_HEALTH_SERVER !== "false",
  defaultMinUpvotes: parseInt(process.env.DEFAULT_MIN_UPVOTES || "4", 10),
  schedulerIntervalMs: parseInt(process.env.SCHEDULER_INTERVAL_MS || "30000", 10),
  get adminUserIds(): string[] {
    const raw =
      process.env.ADMIN_USER_ID ||
      process.env.ADMIN_USER_IDS ||
      process.env.DEV_ADMIN_ID ||
      process.env.DEV_ADMIN_USER_ID ||
      "";
    return parseAdminUserIds(raw);
  },
  get adminUserId(): string | undefined {
    return this.adminUserIds[0];
  },
};
export { parseAdminUserIds };

