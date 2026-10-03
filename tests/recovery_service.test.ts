import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { ChannelType } from "discord.js";
import { RebrandDatabase, setDatabase } from "../src/database";
import { recoveryService } from "../src/services/recoveryService";
import { getContainerText } from "../src/services/announcement";
import fs from "fs";
import path from "path";

describe("RecoveryService retroactive synchronization", () => {
  const testDbPath = path.resolve(process.cwd(), "data", "test_recovery.sqlite");
  let db: RebrandDatabase;

  beforeEach(() => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    db = new RebrandDatabase(testDbPath);
    setDatabase(db);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    setDatabase(new RebrandDatabase());
  });

  it("discovers untracked tagged forum threads created during downtime and pins proposal cards", async () => {
    db.updateGuildSettings("guild-recov-1", {
      forum_channel_id: "forum-recov-chan",
      rebrand_tag_id: "tag-rebrand-recov",
      min_upvotes: 4,
    });

    let pinned = false;
    let cardSent = false;

    const threadMock: any = {
      id: "thread-offline-1",
      parentId: "forum-recov-chan",
      appliedTags: ["tag-rebrand-recov"],
      ownerId: "thread-author-1",
      guild: {
        id: "guild-recov-1",
        ownerId: "guild-owner",
      },
      isThread: () => true,
      fetchStarterMessage: async () => ({
        id: "thread-offline-1",
        author: { id: "thread-author-1" },
        reactions: {
          cache: new Map([
            [
              "⬆️",
              {
                emoji: { name: "⬆️" },
                users: {
                  fetch: async () =>
                    new Map([
                      ["thread-author-1", { bot: false, id: "thread-author-1" }],
                      ["voter-offline-1", { bot: false, id: "voter-offline-1" }],
                      ["voter-offline-2", { bot: false, id: "voter-offline-2" }],
                    ]),
                },
              },
            ],
          ]),
        },
      }),
      messages: {
        fetch: async () => [],
      },
      send: async () => {
        cardSent = true;
        return {
          id: "bot-card-offline-1",
          pinned: false,
          pin: async () => {
            pinned = true;
          },
        };
      },
    };

    const forumMock: any = {
      id: "forum-recov-chan",
      type: ChannelType.GuildForum,
      threads: {
        fetchActive: async () => ({
          threads: new Map([["thread-offline-1", threadMock]]),
        }),
        fetchArchived: async () => ({
          threads: new Map(),
        }),
      },
    };

    const guildMock: any = {
      id: "guild-recov-1",
      name: "Recovery Guild",
      ownerId: "guild-owner",
      channels: {
        fetch: async (id: string) => {
          if (id === "forum-recov-chan") return forumMock;
          if (id === "thread-offline-1") return threadMock;
          return null;
        },
      },
    };

    const report = await recoveryService.syncGuild(guildMock, db);

    expect(report.threadsProcessed).toBe(1);
    expect(report.proposalsCreated).toBe(1);
    expect(report.cardsPinned).toBe(1);
    expect(cardSent).toBe(true);
    expect(pinned).toBe(true);

    const proposal = db.getProposalByThreadId("thread-offline-1");
    expect(proposal).toBeDefined();
    expect(proposal?.user_id).toBe("thread-author-1");
    expect(proposal?.upvotes_count).toBe(2); // author excluded, 2 voter upvotes recorded
  });

  it("catches up missed reaction changes on existing threads while offline", async () => {
    db.updateGuildSettings("guild-recov-2", {
      forum_channel_id: "forum-recov-chan-2",
      rebrand_tag_id: "tag-rebrand-recov-2",
      min_upvotes: 3,
    });

    const proposal = db.createProposal({
      guildId: "guild-recov-2",
      userId: "thread-author-2",
      name: "Retro City",
      iconUrl: "https://example.com/icon.png",
      threadId: "thread-offline-2",
      isReady: 1,
    });
    db.updateProposalMessage(proposal.id, "bot-card-offline-2", "thread-offline-2", "thread-offline-2");

    let edited = false;

    const botCardMsg: any = {
      id: "bot-card-offline-2",
      pinned: true,
      edit: async () => {
        edited = true;
      },
    };

    const threadMock: any = {
      id: "thread-offline-2",
      parentId: "forum-recov-chan-2",
      appliedTags: ["tag-rebrand-recov-2"],
      ownerId: "thread-author-2",
      guild: {
        id: "guild-recov-2",
        ownerId: "guild-owner",
      },
      isThread: () => true,
      fetchStarterMessage: async () => ({
        id: "thread-offline-2",
        author: { id: "thread-author-2" },
        reactions: {
          cache: new Map([
            [
              "⬆️",
              {
                emoji: { name: "⬆️" },
                users: {
                  fetch: async () =>
                    new Map([
                      ["voter-a", { bot: false, id: "voter-a" }],
                      ["voter-b", { bot: false, id: "voter-b" }],
                      ["voter-c", { bot: false, id: "voter-c" }],
                    ]),
                },
              },
            ],
          ]),
        },
      }),
      messages: {
        fetch: async (id: string) => {
          if (id === "bot-card-offline-2") return botCardMsg;
          return null;
        },
      },
    };

    const forumMock: any = {
      id: "forum-recov-chan-2",
      type: ChannelType.GuildForum,
      threads: {
        fetchActive: async () => ({
          threads: new Map([["thread-offline-2", threadMock]]),
        }),
        fetchArchived: async () => ({
          threads: new Map(),
        }),
      },
    };

    const guildMock: any = {
      id: "guild-recov-2",
      name: "Recovery Guild 2",
      channels: {
        fetch: async (id: string) => {
          if (id === "forum-recov-chan-2") return forumMock;
          if (id === "thread-offline-2") return threadMock;
          return null;
        },
      },
    };

    const report = await recoveryService.syncGuild(guildMock, db);

    expect(report.votesRecounted).toBe(1);
    expect(edited).toBe(true);

    const updated = db.getProposal(proposal.id);
    expect(updated?.upvotes_count).toBe(3);
  });

  it("retroactively updates existing proposal cards to the new embed styling on restart", async () => {
    const guildId = "guild-recov-retro";
    db.updateGuildSettings(guildId, {
      forum_channel_id: "forum-recov-retro",
      rebrand_tag_id: "tag-rebrand-retro",
      min_upvotes: 4,
    });

    const proposal = db.createProposal({
      guildId,
      userId: "creator-retro",
      name: "Clean Minimalist Rebrand",
      threadId: "thread-retro-1",
    });
    db.updateProposalMessage(proposal.id, "msg-card-retro-1", "thread-retro-1", "thread-retro-1");

    let editedPayload: any = null;
    const mockCardMsg: any = {
      id: "msg-card-retro-1",
      pinned: true,
      edit: async (payload: any) => {
        editedPayload = payload;
      },
    };

    let mockGuild: any;
    const mockThread: any = {
      id: "thread-retro-1",
      ownerId: "creator-retro",
      guild: null as any,
      appliedTags: ["tag-rebrand-retro"],
      messages: {
        fetch: async (msgId: string) => {
          if (msgId === "msg-card-retro-1") return mockCardMsg;
          return null;
        },
      },
      reactions: { cache: new Map() },
    };

    const mockForum: any = {
      id: "forum-recov-retro",
      type: ChannelType.GuildForum,
      threads: {
        fetchActive: async () => ({
          threads: new Map([["thread-retro-1", mockThread]]),
        }),
        fetchArchived: async () => ({
          threads: new Map(),
        }),
      },
    };

    mockGuild = {
      ownerId: "owner-retro",
      id: guildId,
      name: "Retro Guild",
      channels: {
        fetch: async (id: string) => {
          if (id === "forum-recov-retro") return mockForum;
          if (id === "thread-retro-1") return mockThread;
          return null;
        },
      },
    };

    mockThread.guild = mockGuild;
    mockThread.name = "Clean Minimalist Rebrand";
    await recoveryService.syncGuild(mockGuild, db);

    expect(editedPayload).not.toBeNull();
    expect(editedPayload.flags).toBeDefined();
    const text = getContainerText(editedPayload);
    // Title and description match clean formatting
    expect(text).toContain(`Proposal #${proposal.id} — Clean Minimalist Rebrand`);
    expect(text).toContain("Status: Needs Icon");
    expect(text).toContain("• **Creator:** <@creator-retro>");
    expect(text).toContain("• **Icon:** Not Uploaded");
    expect(text).toContain("### Voting");
  });

  it("strictly ignores threads without the rebrand tag and deletes any wrong bot proposal cards", async () => {
    const guildId = "guild-filter-test";
    db.updateGuildSettings(guildId, {
      forum_channel_id: "forum-general",
      rebrand_tag_id: "tag-weekend-rebrand",
      approved_tag_id: "tag-general-approved",
      declined_tag_id: "tag-general-declined",
    });

    let wrongCardDeleted = false;
    let pinNotificationDeleted = false;
    let legitimateCardSent = false;

    // 1. Thread with general "Approved" tag, but NOT "Weekend Rebrand"
    const generalApprovedThread: any = {
      id: "thread-minecraft-server",
      name: "Make a Minecraft Server",
      appliedTags: ["tag-general-approved"], // matches approved_tag_id, but NOT rebrand_tag_id!
      client: { user: { id: "bot-client-user" } },
      send: async () => {
        throw new Error("Should never send message to non-rebrand thread!");
      },
      messages: {
        fetch: async () =>
          new Map([
            [
              "wrong-bot-msg-1",
              {
                id: "wrong-bot-msg-1",
                author: { id: "bot-client-user" },
                embeds: [{ title: "Proposal #99 — Pending Rebrand" }],
                delete: async () => {
                  wrongCardDeleted = true;
                },
              },
            ],
            [
              "pin-notif-1",
              {
                id: "pin-notif-1",
                type: 24,
                deletable: true,
                delete: async () => {
                  pinNotificationDeleted = true;
                },
              },
            ],
          ]),
      },
    };

    // 2. Legitimate rebrand thread with "Weekend Rebrand" tag
    const legitimateRebrandThread: any = {
      id: "thread-cyberpunk-nook",
      name: "Cyberpunk Nook",
      appliedTags: ["tag-weekend-rebrand"],
      ownerId: "author-cyber",
      client: { user: { id: "bot-client-user" } },
      isThread: () => true,
      fetchStarterMessage: async () => ({
        id: "thread-cyberpunk-nook",
        author: { id: "author-cyber" },
        reactions: { cache: new Map() },
      }),
      messages: {
        fetch: async () => [],
      },
      send: async () => {
        legitimateCardSent = true;
        return {
          id: "bot-card-cyber",
          pinned: false,
          pin: async () => {},
        };
      },
    };

    const mockForum: any = {
      id: "forum-general",
      type: ChannelType.GuildForum,
      threads: {
        fetchActive: async () => ({
          threads: new Map([
            ["thread-minecraft-server", generalApprovedThread],
            ["thread-cyberpunk-nook", legitimateRebrandThread],
          ]),
        }),
        fetchArchived: async () => ({ threads: new Map() }),
      },
    };

    const mockGuild: any = {
      id: guildId,
      name: "Filter Guild",
      ownerId: "guild-owner",
      channels: {
        fetch: async (id: string) => {
          if (id === "forum-general") return mockForum;
          if (id === "thread-minecraft-server") return generalApprovedThread;
          if (id === "thread-cyberpunk-nook") return legitimateRebrandThread;
          return null;
        },
      },
    };

    generalApprovedThread.guild = mockGuild;
    legitimateRebrandThread.guild = mockGuild;

    const report = await recoveryService.syncGuild(mockGuild, db);

    // Only the 1 legitimate rebrand thread should be processed as a proposal
    expect(report.proposalsCreated).toBe(1);
    expect(report.threadsProcessed).toBe(1);
    expect(legitimateCardSent).toBe(true);

    // Erroneous card in the general suggestion thread must have been retroactively deleted
    expect(wrongCardDeleted).toBe(true);
    expect(pinNotificationDeleted).toBe(true);

    // Verify database only has the legitimate proposal
    const proposals = db.getAllProposals(guildId);
    expect(proposals.length).toBe(1);
    expect(proposals[0]?.thread_id).toBe("thread-cyberpunk-nook");
    expect(db.getProposalByThreadId("thread-minecraft-server")).toBeNull();
  });
});
