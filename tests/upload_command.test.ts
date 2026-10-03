import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import fs from "fs";
import path from "path";
import { PermissionsBitField } from "discord.js";
import { database } from "../src/database";
import { rebrandAdminCommand, handleRebrandAdminCommand } from "../src/commands/admin";
import { handleInteraction } from "../src/handlers/interactionHandler";
import { rebrandService } from "../src/services/rebrandService";

describe("Rebrand Upload Command & Upload Button Redesign", () => {
  beforeEach(() => {
    (database as any).db.exec("DELETE FROM proposals;");
    (database as any).db.exec("DELETE FROM guild_settings;");
  });

  it("ensures rebrand slash command has no default_member_permissions restriction", () => {
    const json = rebrandAdminCommand.toJSON();
    expect(json.name).toBe("rebrand");
    expect(json.default_member_permissions).toBeUndefined();
  });

  it("blocks non-administrators from running admin-only subcommands", async () => {
    let replyPayload: any = null;
    const interactionMock: any = {
      guild: {
        id: "guild-test-1",
        name: "Test Guild",
        ownerId: "guild-owner-user",
      },
      user: { id: "regular-user", tag: "regular#0001" },
      memberPermissions: new PermissionsBitField([]),
      options: {
        getSubcommand: () => "config",
      },
      reply: async (payload: any) => {
        replyPayload = payload;
      },
    };

    await handleRebrandAdminCommand(interactionMock);

    expect(replyPayload).not.toBeNull();
    expect(replyPayload.embeds[0].data.title).toBe("Permission Denied");
    expect(replyPayload.embeds[0].data.description).toContain("Administrator");
  });

  it("rejects non-image file uploads in /rebrand upload", async () => {
    let replyPayload: any = null;
    const interactionMock: any = {
      guild: {
        id: "guild-test-1",
        name: "Test Guild",
        ownerId: "guild-owner-user",
      },
      user: { id: "author-user", tag: "author#0001" },
      memberPermissions: new PermissionsBitField([]),
      options: {
        getSubcommand: () => "upload",
        getAttachment: (name: string) => ({
          name: "document.pdf",
          contentType: "application/pdf",
          url: "https://example.com/document.pdf",
        }),
        getInteger: (name: string) => 1,
        getString: (name: string) => null,
      },
      channel: {
        isThread: () => false,
      },
      reply: async (payload: any) => {
        replyPayload = payload;
      },
    };

    await handleRebrandAdminCommand(interactionMock);

    expect(replyPayload).not.toBeNull();
    expect(replyPayload.embeds[0].data.title).toBe("Invalid Image File");
  });

  it("requires proposal ID if /rebrand upload is run outside a thread without id", async () => {
    let replyPayload: any = null;
    const interactionMock: any = {
      guild: {
        id: "guild-test-1",
        name: "Test Guild",
        ownerId: "guild-owner-user",
      },
      user: { id: "author-user", tag: "author#0001" },
      memberPermissions: new PermissionsBitField([]),
      options: {
        getSubcommand: () => "upload",
        getAttachment: (name: string) => ({
          name: "logo.png",
          contentType: "image/png",
          url: "https://example.com/logo.png",
        }),
        getInteger: (name: string) => null,
        getString: (name: string) => null,
      },
      channel: {
        isThread: () => false,
      },
      reply: async (payload: any) => {
        replyPayload = payload;
      },
    };

    await handleRebrandAdminCommand(interactionMock);

    expect(replyPayload).not.toBeNull();
    expect(replyPayload.embeds[0].data.title).toBe("Proposal ID Required");
  });

  it("prevents non-author non-admins from uploading to someone else's proposal", async () => {
    const proposal = database.createProposal({
      guildId: "guild-test-1",
      userId: "original-author",
      name: "Original Rebrand",
    });

    let replyPayload: any = null;
    const interactionMock: any = {
      guild: {
        id: "guild-test-1",
        name: "Test Guild",
        ownerId: "guild-owner-user",
      },
      user: { id: "random-member", tag: "random#0001" },
      memberPermissions: new PermissionsBitField([]),
      options: {
        getSubcommand: () => "upload",
        getAttachment: (name: string) => ({
          name: "logo.png",
          contentType: "image/png",
          url: "https://example.com/logo.png",
        }),
        getInteger: (name: string) => proposal.id,
        getString: (name: string) => null,
      },
      channel: {
        isThread: () => false,
      },
      reply: async (payload: any) => {
        replyPayload = payload;
      },
    };

    await handleRebrandAdminCommand(interactionMock);

    expect(replyPayload).not.toBeNull();
    expect(replyPayload.embeds[0].data.title).toBe("Permission Denied");
    expect(replyPayload.embeds[0].data.description).toContain("Only the proposal author or server administrators");
  });

  it("allows proposal authors to upload server icon with /rebrand upload", async () => {
    const proposal = database.createProposal({
      guildId: "guild-test-1",
      userId: "author-user",
      name: "Spring Awakening",
      threadId: "thread-spring-1",
    });

    const originalDownload = rebrandService.downloadAndCacheImage;
    rebrandService.downloadAndCacheImage = async () => ({
      filePath: "/fake/path/icon.png",
      buffer: Buffer.from("fake-icon-buffer"),
    });

    try {
      let deferred = false;
      let editPayload: any = null;

      const interactionMock: any = {
        guild: {
          id: "guild-test-1",
          name: "Test Guild",
          ownerId: "guild-owner-user",
          channels: {
            fetch: async () => null,
          },
        },
        user: { id: "author-user", tag: "author#0001" },
        memberPermissions: new PermissionsBitField([]),
        options: {
          getSubcommand: () => "upload",
          getAttachment: (name: string) => ({
            name: "flower.png",
            contentType: "image/png",
            url: "https://example.com/flower.png",
          }),
          getInteger: (name: string) => null, // resolved via thread
          getString: (name: string) => null,
        },
        channel: {
          id: "thread-spring-1",
          isThread: () => true,
          ownerId: "author-user",
        },
        deferReply: async () => {
          deferred = true;
        },
        editReply: async (payload: any) => {
          editPayload = payload;
        },
      };

      await handleRebrandAdminCommand(interactionMock);

      expect(deferred).toBe(true);
      expect(editPayload).not.toBeNull();
      expect(editPayload.embeds[0].data.title).toContain("Server Icon Uploaded");

      const updated = database.getProposal(proposal.id);
      expect(updated?.icon_url).toBe("https://example.com/flower.png");
      expect(updated?.is_ready).toBe(1);
    } finally {
      rebrandService.downloadAndCacheImage = originalDownload;
    }
  });

  it("Upload Icon button instructs user with ephemeral slash command guidance", async () => {
    const proposal = database.createProposal({
      guildId: "guild-test-1",
      userId: "author-user",
      name: "Neon Glow",
      threadId: "thread-neon-1",
    });

    let replyPayload: any = null;
    const buttonInteraction: any = {
      isButton: () => true,
      isChatInputCommand: () => false,
      isModalSubmit: () => false,
      isStringSelectMenu: () => false,
      isChannelSelectMenu: () => false,
      customId: `rebrand_upload_icon:${proposal.id}`,
      user: { id: "author-user", tag: "author#0001" },
      guildId: "guild-test-1",
      guild: {
        id: "guild-test-1",
        ownerId: "guild-owner-user",
      },
      memberPermissions: new PermissionsBitField([]),
      channel: {
        id: "thread-neon-1",
        isThread: () => true,
        ownerId: "author-user",
      },
      reply: async (payload: any) => {
        replyPayload = payload;
      },
    };

    await handleInteraction(buttonInteraction);

    expect(replyPayload).not.toBeNull();
    expect(replyPayload.embeds[0].data.title).toContain("Upload Server Icon");
    expect(replyPayload.embeds[0].data.description).toContain("/rebrand upload");
    expect(replyPayload.flags).toBeDefined();
  });
});
