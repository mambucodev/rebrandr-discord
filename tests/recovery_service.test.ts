import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { ChannelType } from "discord.js";
import { RebrandDatabase, setDatabase } from "../src/database";
import { recoveryService } from "../src/services/recoveryService";
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

    let editedEmbed: any = null;
    const mockCardMsg: any = {
      id: "msg-card-retro-1",
      pinned: true,
      edit: async ({ embeds }: any) => {
        editedEmbed = embeds[0]?.toJSON();
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

    expect(editedEmbed).not.toBeNull();
    // Embed fields must be completely removed
    expect(editedEmbed.fields).toBeUndefined();
    // Title and description match clean formatting
    expect(editedEmbed.title).toBe(`Proposal #${proposal.id} — Clean Minimalist Rebrand`);
    expect(editedEmbed.description).toContain("**Status:** Needs Icon");
    expect(editedEmbed.description).toContain("• **Creator:** <@creator-retro>");
    expect(editedEmbed.description).toContain("• **Icon:** Not Uploaded");
    expect(editedEmbed.description).toContain("• **Voting:**");
  });
});
