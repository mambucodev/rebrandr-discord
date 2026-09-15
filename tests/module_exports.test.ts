import { describe, it, expect } from "bun:test";

describe("Module imports and exports resolution", () => {
  it("imports all command modules without unresolved exports", async () => {
    const adminModule = await import("../src/commands/admin");
    expect(adminModule.rebrandAdminCommand).toBeDefined();
    expect(adminModule.hasAdminPermission).toBeDefined();
    expect(typeof adminModule.hasAdminPermission).toBe("function");

    const commandsModule = await import("../src/commands/index");
    expect(commandsModule.commands).toBeDefined();
    expect(commandsModule.handleCommandInteraction).toBeDefined();
  });

  it("imports all handler modules without unresolved exports", async () => {
    const interactionHandler = await import("../src/handlers/interactionHandler");
    expect(interactionHandler.handleInteraction).toBeDefined();

    const threadHandler = await import("../src/handlers/threadHandler");
    expect(threadHandler.handleThreadCreate).toBeDefined();
    expect(threadHandler.handleThreadUpdate).toBeDefined();
    expect(threadHandler.handleReactionEvent).toBeDefined();
    expect(threadHandler.updateThreadStatusTag).toBeDefined();
  });

  it("imports all service modules without unresolved exports", async () => {
    const announcement = await import("../src/services/announcement");
    expect(announcement.createProposalEmbed).toBeDefined();
    expect(announcement.createForumTagConfigEmbedAndRows).toBeDefined();
    expect(announcement.hasAdminPermission).toBeDefined();

    const health = await import("../src/services/healthServer");
    expect(health.startHealthServer).toBeDefined();

    const recovery = await import("../src/services/recoveryService");
    expect(recovery.recoveryService).toBeDefined();

    const rebrand = await import("../src/services/rebrandService");
    expect(rebrand.rebrandService).toBeDefined();

    const scheduler = await import("../src/services/scheduler");
    expect(scheduler.scheduler).toBeDefined();
  });
});
