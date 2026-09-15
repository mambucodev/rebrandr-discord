import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import path from "path";
import { RebrandDatabase } from "../src/database";
import {
  updateThreadStatusTag,
  handleThreadUpdate,
} from "../src/handlers/threadHandler";
import { createForumTagConfigEmbedAndRows } from "../src/services/announcement";
import { RecoveryService } from "../src/services/recoveryService";

const TEST_DB_PATH = path.join(process.cwd(), "tests", "test_tags_lifecycle.sqlite");

describe("Forum Tags Lifecycle & Moderator Untag Detection", () => {
  let db: RebrandDatabase;

  beforeEach(() => {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
    db = new RebrandDatabase(TEST_DB_PATH);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  });

  it("saves approved_tag_id and declined_tag_id in guild settings", () => {
    const guildId = "guild-tags-1";
    const initial = db.getGuildSettings(guildId);
    expect(initial.rebrand_tag_id).toBeNull();
    expect(initial.approved_tag_id).toBeNull();
    expect(initial.declined_tag_id).toBeNull();

    const updated = db.updateGuildSettings(guildId, {
      forum_channel_id: "forum-123",
      rebrand_tag_id: "tag-rebrand-pending",
      approved_tag_id: "tag-rebrand-approved",
      declined_tag_id: "tag-rebrand-declined",
    });

    expect(updated.forum_channel_id).toBe("forum-123");
    expect(updated.rebrand_tag_id).toBe("tag-rebrand-pending");
    expect(updated.approved_tag_id).toBe("tag-rebrand-approved");
    expect(updated.declined_tag_id).toBe("tag-rebrand-declined");

    const fetched = db.getGuildSettings(guildId);
    expect(fetched.approved_tag_id).toBe("tag-rebrand-approved");
    expect(fetched.declined_tag_id).toBe("tag-rebrand-declined");
  });

  it("updateThreadStatusTag ensures only one status tag is assigned at a time", async () => {
    const settings = {
      guild_id: "guild-1",
      logs_channel_id: null,
      forum_channel_id: "forum-1",
      rebrand_tag_id: "tag-pending",
      approved_tag_id: "tag-approved",
      declined_tag_id: "tag-declined",
      min_upvotes: 4,
      custom_upvote_emojis: null,
      custom_downvote_emojis: null,
      default_name: null,
      default_icon_url: null,
      default_icon_path: null,
      active_proposal_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    let appliedTags: string[] = ["tag-pending", "tag-general-discussion"];

    const mockThread: any = {
      name: "Cyberpunk Weekend",
      id: "thread-101",
      get appliedTags() {
        return appliedTags;
      },
      setAppliedTags: async (newTags: string[]) => {
        appliedTags = newTags;
      },
    };

    // 1. Transition to Approved: should replace tag-pending with tag-approved, preserving non-status tags
    await updateThreadStatusTag(mockThread, "approved", settings);

    expect(appliedTags).toContain("tag-approved");
    expect(appliedTags).not.toContain("tag-pending");
    expect(appliedTags).not.toContain("tag-declined");
    expect(appliedTags).toContain("tag-general-discussion");

    // 2. Transition from Approved to Declined: should replace tag-approved with tag-declined
    await updateThreadStatusTag(mockThread, "declined", settings);

    expect(appliedTags).toContain("tag-declined");
    expect(appliedTags).not.toContain("tag-approved");
    expect(appliedTags).not.toContain("tag-pending");
    expect(appliedTags).toContain("tag-general-discussion");

    // Only one status tag is present
    const statusTagsCount = appliedTags.filter((t) =>
      [settings.rebrand_tag_id, settings.approved_tag_id, settings.declined_tag_id].includes(t)
    ).length;
    expect(statusTagsCount).toBe(1);
  });

  it("ignores rebrand tag removal when the bot swapped it to Approved tag", async () => {
    const guildId = "guild-ignore-swap";
    const settings = db.updateGuildSettings(guildId, {
      forum_channel_id: "forum-swap",
      rebrand_tag_id: "tag-pending",
      approved_tag_id: "tag-approved",
      declined_tag_id: "tag-declined",
    });

    const proposal = db.createProposal({
      guildId,
      userId: "user-author",
      name: "Swap Test Proposal",
      threadId: "thread-swap-1",
    });

    // Mark as approved in DB
    db.approveProposal(proposal.id, "admin-user");

    const oldThread: any = {
      id: "thread-swap-1",
      parentId: settings.forum_channel_id,
      guild: { id: guildId, name: "Test Guild" },
      appliedTags: ["tag-pending"],
    };

    // New thread state has tag-approved instead of tag-pending
    const newThread: any = {
      id: "thread-swap-1",
      name: "Swap Test Proposal",
      parentId: settings.forum_channel_id,
      guild: { id: guildId, name: "Test Guild" },
      appliedTags: ["tag-approved"],
    };

    await handleThreadUpdate(oldThread, newThread, db);

    // Proposal must stay approved, NOT cancelled!
    const checkProposal = db.getProposal(proposal.id);
    expect(checkProposal?.status).toBe("approved");
  });

  it("cancels pending proposal when a moderator removes the rebrand tag without assigning status tag", async () => {
    const guildId = "guild-mod-untag";
    const settings = db.updateGuildSettings(guildId, {
      forum_channel_id: "forum-mod",
      rebrand_tag_id: "tag-rebrand",
      approved_tag_id: "tag-approved",
      declined_tag_id: "tag-declined",
    });

    const proposal = db.createProposal({
      guildId,
      userId: "user-author-2",
      name: "Off-Topic Thread",
      threadId: "thread-mod-untag-1",
    });

    let editedEmbeds: any[] = [];
    const oldThread: any = {
      id: "thread-mod-untag-1",
      parentId: settings.forum_channel_id,
      guild: { id: guildId, name: "Test Guild" },
      appliedTags: ["tag-rebrand"],
    };

    // Moderator removed tag-rebrand because it's not a rebrand (no approved or declined tag was added)
    const newThread: any = {
      id: "thread-mod-untag-1",
      name: "Off-Topic Thread",
      parentId: settings.forum_channel_id,
      guild: { id: guildId, name: "Test Guild" },
      appliedTags: ["tag-off-topic"],
      messages: {
        fetch: async () => ({
          edit: async ({ embeds }: any) => {
            editedEmbeds = embeds;
          },
        }),
      },
    };

    db.updateProposalMessage(proposal.id, "card-msg-123", newThread.id, newThread.id);

    await handleThreadUpdate(oldThread, newThread, db);

    // Proposal should now be cancelled
    const updatedProposal = db.getProposal(proposal.id);
    expect(updatedProposal?.status).toBe("cancelled");
  });

  it("RecoveryService cancels pending proposals whose rebrand tag was stripped offline by a moderator", async () => {
    const guildId = "guild-offline-untag";
    db.updateGuildSettings(guildId, {
      forum_channel_id: "forum-offline",
      rebrand_tag_id: "tag-rebrand-offline",
      approved_tag_id: "tag-approved-offline",
      declined_tag_id: "tag-declined-offline",
    });

    const proposal = db.createProposal({
      guildId,
      userId: "user-offline",
      name: "Offline Untagged Proposal",
      threadId: "thread-offline-untagged",
    });

    const mockGuild: any = {
      id: guildId,
      name: "Offline Guild",
      channels: {
        fetch: async (channelId: string) => {
          if (channelId === "forum-offline") {
            return {
              type: 15, // GuildForum
              threads: {
                fetchActive: async () => ({ threads: new Map() }),
                fetchArchived: async () => ({ threads: new Map() }),
              },
            };
          }
          if (channelId === "thread-offline-untagged") {
            return {
              id: "thread-offline-untagged",
              appliedTags: ["tag-some-other-tag"], // Moderator stripped tag-rebrand-offline
            };
          }
          return null;
        },
      },
    };

    const recovery = new RecoveryService();
    const report = await recovery.syncGuild(mockGuild, db);

    expect(report.staleProposalsCleaned).toBe(1);
    const updated = db.getProposal(proposal.id);
    expect(updated?.status).toBe("cancelled");
  });

  it("createForumTagConfigEmbedAndRows generates 3 select menus with Clear option", () => {
    const mockForum: any = {
      id: "forum-ui-test",
      availableTags: [
        { id: "tag-1", name: "Rebrand" },
        { id: "tag-2", name: "Approved", emoji: { name: "✅" } },
        { id: "tag-3", name: "Declined", emoji: { name: "❌" } },
      ],
    };

    const settings = {
      guild_id: "guild-ui",
      logs_channel_id: null,
      forum_channel_id: "forum-ui-test",
      rebrand_tag_id: "tag-1",
      approved_tag_id: "tag-2",
      declined_tag_id: null,
      min_upvotes: 4,
      custom_upvote_emojis: null,
      custom_downvote_emojis: null,
      default_name: null,
      default_icon_url: null,
      default_icon_path: null,
      active_proposal_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { embed, rows } = createForumTagConfigEmbedAndRows(mockForum, settings);

    expect(embed.data.title).toContain("Configure Forum Status Tags");
    expect(rows.length).toBe(3);

    // Row 0: Rebrand tag select
    const menu0 = rows[0].components[0] as any;
    expect(menu0.data.custom_id).toBe("rebrand_tag_select:rebrand:forum-ui-test");
    const opt0Val = menu0.options[0]?.data?.value ?? menu0.options[0]?.value ?? menu0.data?.options?.[0]?.value;
    expect(opt0Val).toBe("clear");
    const opt1Val = menu0.options[1]?.data?.value ?? menu0.options[1]?.value ?? menu0.data?.options?.[1]?.value;
    expect(opt1Val).toBe("tag-1");

    // Row 1: Approved tag select
    const menu1 = rows[1].components[0] as any;
    expect(menu1.data.custom_id).toBe("rebrand_tag_select:approved:forum-ui-test");

    // Row 2: Declined tag select
    const menu2 = rows[2].components[0] as any;
    expect(menu2.data.custom_id).toBe("rebrand_tag_select:declined:forum-ui-test");
  });
});
