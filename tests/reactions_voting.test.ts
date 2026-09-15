import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { RebrandDatabase, setDatabase } from "../src/database";
import {
  handleReactionEvent,
  handleThreadCreate,
  shouldCountReaction,
  collectVoteUserIds,
  parseEmojiTokens,
  isUpvoteEmoji,
  isDownvoteEmoji,
} from "../src/handlers/threadHandler";
import fs from "fs";
import path from "path";

describe("Thread reactions & voting rules", () => {
  const testDbPath = path.resolve(process.cwd(), "data", "test_reactions.sqlite");
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

  it("parses emoji tokens from various formats", () => {
    const rawInput = "<:pepe_up:123456789012345678> <a:pepe_anim:987654321012345678> :fire: 🚀, 112233445566778899";
    const tokens = parseEmojiTokens(rawInput);

    expect(tokens).toContain("pepe_up");
    expect(tokens).toContain("123456789012345678");
    expect(tokens).toContain("pepe_anim");
    expect(tokens).toContain("987654321012345678");
    expect(tokens).toContain("fire");
    expect(tokens).toContain("🚀");
    expect(tokens).toContain("112233445566778899");
  });

  it("identifies custom configured upvote and downvote emojis including server custom emojis", () => {
    const customUpvotes = "<:rebrand_yes:123456789012345678> :hype: 🚀";
    const customDownvotes = "<:rebrand_no:987654321098765432> :trash: 💩";

    // Custom upvote match by ID
    expect(isUpvoteEmoji({ name: "rebrand_yes", id: "123456789012345678" }, customUpvotes)).toBe(true);
    // Custom upvote match by name
    expect(isUpvoteEmoji({ name: "hype", id: "55555555" }, customUpvotes)).toBe(true);
    // Custom upvote match unicode
    expect(isUpvoteEmoji({ name: "🚀", id: null }, customUpvotes)).toBe(true);
    // Default upvote still works
    expect(isUpvoteEmoji({ name: "⬆️", id: null }, customUpvotes)).toBe(true);

    // Custom downvote match by ID
    expect(isDownvoteEmoji({ name: "rebrand_no", id: "987654321098765432" }, customDownvotes)).toBe(true);
    // Custom downvote match by name
    expect(isDownvoteEmoji({ name: "trash", id: "44444444" }, customDownvotes)).toBe(true);
    // Custom downvote match unicode
    expect(isDownvoteEmoji({ name: "💩", id: null }, customDownvotes)).toBe(true);
    // Default downvote still works
    expect(isDownvoteEmoji({ name: "⬇️", id: null }, customDownvotes)).toBe(true);

    // Non-configured emoji should not match
    expect(isUpvoteEmoji({ name: "random_emoji", id: "1111111" }, customUpvotes)).toBe(false);
    expect(isDownvoteEmoji({ name: "random_emoji", id: "1111111" }, customDownvotes)).toBe(false);
  });

  it("does not count author votes and deduplicates multiple reactions from the same user", async () => {
    const proposal = db.createProposal({
      guildId: "guild-1",
      userId: "author-user",
      threadId: "thread-100",
      isReady: 1,
    });

    db.updateProposalMessage(proposal.id, "msg-bot-card", "thread-100", "thread-100");

    const starterReactions = new Map<string, any>();
    starterReactions.set("⬆️", {
      emoji: { name: "⬆️" },
      users: {
        fetch: async () =>
          new Map([
            ["author-user", { bot: false, id: "author-user" }], // author: must be ignored
            ["voter-1", { bot: false, id: "voter-1" }],
            ["voter-2", { bot: false, id: "voter-2" }],
            ["bot-1", { bot: true, id: "bot-1" }], // bot: must be ignored
          ]),
      },
    });
    starterReactions.set("👍", {
      emoji: { name: "👍" },
      users: {
        fetch: async () =>
          new Map([
            ["voter-1", { bot: false, id: "voter-1" }], // duplicate upvote by voter-1 with another emoji: must count once
            ["voter-3", { bot: false, id: "voter-3" }],
          ]),
      },
    });
    starterReactions.set("⬇️", {
      emoji: { name: "⬇️" },
      users: {
        fetch: async () =>
          new Map([
            ["voter-4", { bot: false, id: "voter-4" }],
            ["author-user", { bot: false, id: "author-user" }], // author downvote: must be ignored
          ]),
      },
    });

    const starterMessage: any = {
      id: "msg-thread-starter",
      reactions: {
        cache: starterReactions,
      },
    };

    const threadMock: any = {
      id: "thread-100",
      ownerId: "author-user",
      guild: {
        id: "guild-1",
        channels: {
          fetch: async () => null,
        },
      },
      isThread: () => true,
      fetchStarterMessage: async () => starterMessage,
      messages: {
        fetch: async (id: string) => ({
          id,
          edit: async () => {},
        }),
      },
    };

    const reactionMock: any = {
      message: starterMessage,
      partial: false,
      emoji: { name: "⬆️" },
    };
    starterMessage.channel = threadMock;

    await handleReactionEvent(reactionMock, { bot: false, id: "voter-1" } as any, db);

    const counts = db.getVoteCounts(proposal.id);
    expect(counts.upvotes_count).toBe(3);
    expect(counts.downvotes_count).toBe(1);
    expect(counts.net_votes).toBe(2);
  });

  it("handles custom server emojis configured in guild settings during reaction processing", async () => {
    db.updateGuildSettings("guild-custom-emoji", {
      custom_upvote_emojis: "<:server_up:111222333444> 🚀",
      custom_downvote_emojis: "<:server_down:555666777888> 💩",
    });

    const proposal = db.createProposal({
      guildId: "guild-custom-emoji",
      userId: "author-user",
      threadId: "thread-custom-1",
      isReady: 1,
    });
    db.updateProposalMessage(proposal.id, "msg-bot-card", "thread-custom-1", "thread-custom-1");

    const starterReactions = new Map<string, any>();
    starterReactions.set("111222333444", {
      emoji: { name: "server_up", id: "111222333444" },
      users: {
        fetch: async () =>
          new Map([
            ["voter-custom-1", { bot: false, id: "voter-custom-1" }],
          ]),
      },
    });
    starterReactions.set("🚀", {
      emoji: { name: "🚀", id: null },
      users: {
        fetch: async () =>
          new Map([
            ["voter-custom-2", { bot: false, id: "voter-custom-2" }],
          ]),
      },
    });
    starterReactions.set("555666777888", {
      emoji: { name: "server_down", id: "555666777888" },
      users: {
        fetch: async () =>
          new Map([
            ["voter-custom-3", { bot: false, id: "voter-custom-3" }],
          ]),
      },
    });

    const starterMessage: any = {
      id: "msg-starter-custom",
      reactions: {
        cache: starterReactions,
      },
    };

    const threadMock: any = {
      id: "thread-custom-1",
      ownerId: "author-user",
      guild: {
        id: "guild-custom-emoji",
        channels: { fetch: async () => null },
      },
      isThread: () => true,
      fetchStarterMessage: async () => starterMessage,
      messages: {
        fetch: async (id: string) => ({
          id,
          edit: async () => {},
        }),
      },
    };
    starterMessage.channel = threadMock;

    const reactionMock: any = {
      message: starterMessage,
      partial: false,
      emoji: { name: "server_up", id: "111222333444" },
    };

    await handleReactionEvent(reactionMock, { bot: false, id: "voter-custom-1" } as any, db);

    const counts = db.getVoteCounts(proposal.id);
    expect(counts.upvotes_count).toBe(2);
    expect(counts.downvotes_count).toBe(1);
    expect(counts.net_votes).toBe(1);
  });

  it("ignores reactions placed on the bot's auto-sent proposal card message", async () => {
    const proposal = db.createProposal({
      guildId: "guild-1",
      userId: "author-user",
      threadId: "thread-200",
      isReady: 1,
    });
    db.updateProposalMessage(proposal.id, "msg-bot-card", "thread-200", "thread-200");

    const botCardMessage: any = {
      id: "msg-bot-card",
      reactions: {
        cache: new Map([
          [
            "⬆️",
            {
              emoji: { name: "⬆️" },
              users: {
                fetch: async () => new Map([["voter-99", { bot: false, id: "voter-99" }]]),
              },
            },
          ],
        ]),
      },
    };

    const threadMock: any = {
      id: "thread-200",
      ownerId: "author-user",
      guild: { id: "guild-1" },
      isThread: () => true,
      fetchStarterMessage: async () => ({
        id: "msg-thread-starter",
        reactions: { cache: new Map() },
      }),
    };
    botCardMessage.channel = threadMock;

    const reactionMock: any = {
      message: botCardMessage,
      partial: false,
      emoji: { name: "⬆️" },
    };

    await handleReactionEvent(reactionMock, { bot: false, id: "voter-99" } as any, db);

    const counts = db.getVoteCounts(proposal.id);
    expect(counts.upvotes_count).toBe(0);
    expect(counts.downvotes_count).toBe(0);
  });

  it("deduplicates negative reactions and handles multiple emoji variants", async () => {
    const reactions = new Map<string, any>();
    reactions.set("⬇️", {
      emoji: { name: "⬇️" },
      users: {
        fetch: async () =>
          new Map([
            ["user-a", { bot: false, id: "user-a" }],
            ["user-b", { bot: false, id: "user-b" }],
          ]),
      },
    });
    reactions.set("👎", {
      emoji: { name: "👎" },
      users: {
        fetch: async () =>
          new Map([
            ["user-a", { bot: false, id: "user-a" }], // user-a voted down with ⬇️ and 👎
          ]),
      },
    });

    const result = await collectVoteUserIds(reactions, "author-user");
    expect(result.downvotes.length).toBe(2);
    expect(result.downvotes).toContain("user-a");
    expect(result.downvotes).toContain("user-b");
    expect(result.upvotes.length).toBe(0);
  });

  it("shouldCountReaction strictly allows thread starter message and denies auto-sent card", () => {
    const starterId = "thread-post-123";
    const cardId = "bot-card-456";
    const userCommentId = "user-comment-789";

    // Auto-sent card must NEVER count
    expect(shouldCountReaction(cardId, starterId, cardId)).toBe(false);

    // Starter post must count
    expect(shouldCountReaction(starterId, starterId, cardId)).toBe(true);

    // Comments in thread must not count
    expect(shouldCountReaction(userCommentId, starterId, cardId)).toBe(false);
  });

  it("auto-sends and pins the proposal card message in detected thread", async () => {
    db.updateGuildSettings("guild-pin", {
      forum_channel_id: "forum-pin-chan",
      rebrand_tag_id: "tag-pin-123",
      min_upvotes: 4,
    });

    let pinned = false;
    let sentMessageId = "sent-card-msg-1";

    const threadMock: any = {
      id: "thread-pin-999",
      parentId: "forum-pin-chan",
      appliedTags: ["tag-pin-123"],
      ownerId: "author-pin-user",
      guild: {
        id: "guild-pin",
        ownerId: "guild-owner",
      },
      messages: {
        fetch: async () => [],
      },
      send: async () => ({
        id: sentMessageId,
        pinned: false,
        pin: async () => {
          pinned = true;
        },
      }),
    };

    await handleThreadCreate(threadMock);

    expect(pinned).toBe(true);

    const proposal = db.getProposalByThreadId("thread-pin-999");
    expect(proposal).toBeDefined();
    expect(proposal?.message_id).toBe(sentMessageId);
    expect(proposal?.user_id).toBe("author-pin-user");
  });
});
