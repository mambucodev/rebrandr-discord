import type { Client } from "discord.js";
import { config } from "../config";

let serverInstance: any = null;

export function startHealthServer(client: Client): void {
  if (!config.enableHealthServer) {
    console.log("[HealthServer] Health check HTTP server disabled via ENABLE_HEALTH_SERVER=false.");
    return;
  }

  try {
    serverInstance = Bun.serve({
      port: config.port,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/health" || url.pathname === "/") {
          const isReady = client.isReady();
          const body = {
            status: isReady ? "healthy" : "starting",
            botTag: client.user?.tag ?? null,
            guildCount: client.guilds.cache.size,
            uptimeSeconds: Math.floor(process.uptime()),
            timestamp: new Date().toISOString(),
          };

          return new Response(JSON.stringify(body, null, 2), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        return new Response("Not Found", { status: 404 });
      },
    });

    console.log(`[HealthServer] Health check server listening on http://0.0.0.0:${config.port}/health (Coolify & Docker ready)`);
  } catch (err) {
    console.warn(`[HealthServer] Could not start health server on port ${config.port}:`, err);
  }
}

export function stopHealthServer(): void {
  if (serverInstance) {
    serverInstance.stop();
    serverInstance = null;
    console.log("[HealthServer] Health check server stopped.");
  }
}
