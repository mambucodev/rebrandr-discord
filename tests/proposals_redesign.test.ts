import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import path from "path";
import {
  categorizeAndSortProposals,
  createProposalsListEmbed,
  createProposalCarouselEmbed,
  createProposalCarouselActionRows,
  getContainerText,
} from "../src/services/announcement";
import {
  proposalsCommand,
  handleProposalsCommand,
  handleProposalsList,
  handleProposalsBrowse,
} from "../src/commands/proposals";
import { handleInteraction } from "../src/handlers/interactionHandler";
import { RebrandDatabase, setDatabase } from "../src/database";
import type { ProposalWithVotes } from "../src/database";
import { ButtonStyle } from "discord.js";

const TEST_DB_PATH = path.join(__dirname, "../data/test_proposals_redesign.sqlite");

function createMockProposal(overrides: Partial<ProposalWithVotes> = {}): ProposalWithVotes {
  return {
    id: 1,
    guild_id: "guild-1",
    user_id: "user-1",
    name: "Cyberpunk Weekend",
    topic: "Futuristic neon theme",
    icon_url: "https://example.com/icon.png",
    icon_path: "/data/icons/icon.png",
    message_id: "msg-1",
    channel_id: "chan-1",
    thread_id: "thread-1",
    log_message_id: null,
    is_ready: 1,
    status: "pending",
    scheduled_date: null,
    created_at: new Date().toISOString(),
    approved_at: null,
    approved_by: null,
    rejected_at: null,
    rejected_reason: null,
    upvotes_count: 5,
    downvotes_count: 0,
    net_votes: 5,
    vote_count: 5,
    upvotes: 5,
    downvotes: 0,
    netVotes: 5,
    voteCount: 5,
    ...overrides,
  };
}

describe("Proposals Redesign (/proposals list & /proposals browse)", () => {
  let db: RebrandDatabase;

  beforeEach(() => {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
    db = new RebrandDatabase(TEST_DB_PATH);
    setDatabase(db);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  });

  describe("categorizeAndSortProposals", () => {
    it("partitions proposals into 3 categories and sorts descending by upvotes", () => {
      const minUpvotes = 4;
      const pReady1 = createMockProposal({ id: 1, upvotes_count: 6, net_votes: 6, icon_url: "https://example.com/1.png" });
      const pReady2 = createMockProposal({ id: 2, upvotes_count: 8, net_votes: 8, icon_url: "https://example.com/2.png" });
      const pMissingIcon = createMockProposal({ id: 3, upvotes_count: 5, net_votes: 5, icon_url: null, icon_path: null });
      const pVoting1 = createMockProposal({ id: 4, upvotes_count: 2, net_votes: 2 });
      const pVoting2 = createMockProposal({ id: 5, upvotes_count: 3, net_votes: 3 });

      const result = categorizeAndSortProposals([pReady1, pVoting1, pMissingIcon, pReady2, pVoting2], minUpvotes);

      // Ready for approval (Goal met + has icon)
      expect(result.readyToApprove.length).toBe(2);
      expect(result.readyToApprove[0]!.id).toBe(2); // 8 votes
      expect(result.readyToApprove[1]!.id).toBe(1); // 6 votes

      // Goal reached, missing assets (Goal met + no icon)
      expect(result.goalReachedMissingAssets.length).toBe(1);
      expect(result.goalReachedMissingAssets[0]!.id).toBe(3);

      // Voting in progress (votes < minUpvotes)
      expect(result.votingInProgress.length).toBe(2);
      expect(result.votingInProgress[0]!.id).toBe(5); // 3 votes
      expect(result.votingInProgress[1]!.id).toBe(4); // 2 votes

      // allSorted contains all 5 in the exact tiered order
      expect(result.allSorted.map((p) => p.id)).toEqual([2, 1, 3, 5, 4]);
    });
  });

  describe("createProposalsListEmbed", () => {
    const mockGuild = { id: "guild-123", name: "Test Community" } as any;

    it("displays empty state when there are no pending proposals", () => {
      const embed = createProposalsListEmbed([], mockGuild, 4);
      const data = embed.toJSON();

      expect(data.title).toContain("Test Community");
      expect(data.description).toContain("no pending proposals right now");
    });

    it("renders categorized sections with direct thread links and icon indicators", () => {
      const p1 = createMockProposal({
        id: 10,
        guild_id: "guild-123",
        thread_id: "thread-abc",
        name: "Retro Gaming Weekend",
        upvotes_count: 6,
        downvotes_count: 1,
        net_votes: 5,
        icon_url: "https://example.com/retro.png",
      });
      const p2 = createMockProposal({
        id: 20,
        guild_id: "guild-123",
        thread_id: "thread-def",
        name: "Anime & Manga Weekend",
        upvotes_count: 4,
        downvotes_count: 0,
        net_votes: 4,
        icon_url: null,
        icon_path: null,
      });
      const p3 = createMockProposal({
        id: 30,
        guild_id: "guild-123",
        thread_id: "thread-ghi",
        name: "Coding Marathon",
        upvotes_count: 2,
        downvotes_count: 0,
        net_votes: 2,
        icon_url: "https://example.com/code.png",
      });

      const embed = createProposalsListEmbed([p1, p2, p3], mockGuild, 4);
      const data = embed.toJSON();

      expect(data.description).toContain("### 👑 Ready for Approval (1)");
      expect(data.description).toContain("Retro Gaming Weekend");
      expect(data.description).toContain("<#thread-abc>");
      expect(data.description).toContain("https://discord.com/channels/guild-123/thread-abc");
      expect(data.description).toContain("🖼️ Icon: Ready");

      expect(data.description).toContain("### 🟡 Goal Reached — Missing Assets (1)");
      expect(data.description).toContain("Anime & Manga Weekend");
      expect(data.description).toContain("<#thread-def>");
      expect(data.description).toContain("⚠️ Missing Icon");

      expect(data.description).toContain("### ⏳ Voting in Progress (1)");
      expect(data.description).toContain("Coding Marathon");
      expect(data.description).toContain("<#thread-ghi>");
    });
  });

  describe("createProposalCarouselEmbed & createProposalCarouselActionRows", () => {
    const mockGuild = { id: "guild-123", name: "Test Community" } as any;

    it("renders rich carousel card with page counter, thumbnail, and vote progress bar", () => {
      const p = createMockProposal({
        id: 42,
        guild_id: "guild-123",
        thread_id: "thread-42",
        name: "Cyberpunk 2077",
        topic: "Futuristic night vibes",
        icon_url: "https://example.com/cyber.png",
        upvotes_count: 5,
        downvotes_count: 1,
        net_votes: 4,
      });

      const embed = createProposalCarouselEmbed(p, 4, 0, 5, mockGuild);
      const data = embed.toJSON();

      expect(data.title).toBe("Proposal #42 — Cyberpunk 2077");
      expect(data.description).toContain("🟢 Ready for Admin Approval");
      expect(data.description).toContain("Futuristic night vibes");
      expect(data.description).toContain("<#thread-42>");
      expect(data.description).toContain("✅ Uploaded & Ready");
      expect(data.footer?.text).toContain("Proposal 1 of 5");
      expect(data.thumbnail?.url).toBe("https://example.com/cyber.png");
    });

    it("generates navigation and action rows with properly disabled edge buttons", () => {
      const p = createMockProposal({ id: 42, thread_id: "thread-42" });

      // First page (index = 0, total = 3)
      const rowsFirst = createProposalCarouselActionRows(p, 0, 3, "guild-123");
      expect(rowsFirst.length).toBe(2);

      const navButtonsFirst = rowsFirst[0]!.components as any[];
      expect(navButtonsFirst.length).toBe(5);
      expect(navButtonsFirst[0].data.disabled).toBe(true); // First button disabled
      expect(navButtonsFirst[1].data.disabled).toBe(true); // Prev button disabled
      expect(navButtonsFirst[2].data.label).toBe("1 / 3"); // Page indicator
      expect(navButtonsFirst[3].data.disabled).toBe(false); // Next button enabled
      expect(navButtonsFirst[4].data.disabled).toBe(false); // Last button enabled

      // Action row has Thread link, Approve, and Reject buttons
      const actionButtons = rowsFirst[1]!.components as any[];
      expect(actionButtons.length).toBe(3);
      expect(actionButtons[0].data.style).toBe(ButtonStyle.Link);
      expect(actionButtons[0].data.url).toBe("https://discord.com/channels/guild-123/thread-42");
      expect(actionButtons[1].data.custom_id).toBe("rebrand_prop_approve:42:0");
      expect(actionButtons[2].data.custom_id).toBe("rebrand_prop_reject:42:0");

      // Last page (index = 2, total = 3)
      const rowsLast = createProposalCarouselActionRows(p, 2, 3, "guild-123");
      const navButtonsLast = rowsLast[0]!.components as any[];
      expect(navButtonsLast[0].data.disabled).toBe(false); // First button enabled
      expect(navButtonsLast[1].data.disabled).toBe(false); // Prev button enabled
      expect(navButtonsLast[3].data.disabled).toBe(true); // Next button disabled
      expect(navButtonsLast[4].data.disabled).toBe(true); // Last button disabled
    });
  });

  describe("proposalsCommand and Subcommand Registration", () => {
    it("defines slash command structure with browse and list subcommands", () => {
      const json = proposalsCommand.toJSON();
      expect(json.name).toBe("proposals");
      expect(json.options?.some((opt) => opt.name === "browse")).toBe(true);
      expect(json.options?.some((opt) => opt.name === "list")).toBe(true);
    });

    it("executes handleProposalsList when /proposals list is called", async () => {
      db.createProposal({
        guildId: "guild-slash-1",
        userId: "user-1",
        name: "Vaporwave Nights",
        iconUrl: "https://example.com/icon.png",
      });

      let repliedPayload: any = null;
      const mockInteraction: any = {
        guild: { id: "guild-slash-1", name: "Slash Guild" },
        options: {
          getSubcommand: () => "list",
        },
        reply: async (payload: any) => {
          repliedPayload = payload;
        },
      };

      await handleProposalsCommand(mockInteraction);
      expect(repliedPayload).toBeDefined();
      expect(repliedPayload.components).toBeDefined();
      const desc = getContainerText(repliedPayload);
      expect(desc).toContain("Vaporwave Nights");
    });

    it("executes handleProposalsBrowse when /proposals browse is called", async () => {
      db.createProposal({
        guildId: "guild-slash-2",
        userId: "user-1",
        name: "Synthwave Sunset",
        iconUrl: "https://example.com/synth.png",
      });

      let repliedPayload: any = null;
      const mockInteraction: any = {
        guild: { id: "guild-slash-2", name: "Browse Guild" },
        options: {
          getSubcommand: () => "browse",
        },
        reply: async (payload: any) => {
          repliedPayload = payload;
        },
      };

      await handleProposalsCommand(mockInteraction);
      expect(repliedPayload).toBeDefined();
      expect(repliedPayload.components).toBeDefined();
      const title = getContainerText(repliedPayload);
      expect(title).toContain("Synthwave Sunset");
    });
  });

  describe("Carousel Button Interactions in interactionHandler", () => {
    it("updates carousel to next proposal on navigation click", async () => {
      const p1 = db.createProposal({
        guildId: "guild-btn-test",
        userId: "user-1",
        name: "First Proposal",
        iconUrl: "https://example.com/1.png",
      });
      const p2 = db.createProposal({
        guildId: "guild-btn-test",
        userId: "user-2",
        name: "Second Proposal",
        iconUrl: "https://example.com/2.png",
      });

      let updatedPayload: any = null;
      const mockButtonInteraction: any = {
        isChatInputCommand: () => false,
        isButton: () => true,
        isModalSubmit: () => false,
        isStringSelectMenu: () => false,
        customId: "rebrand_prop_nav:next:1",
        guild: { id: "guild-btn-test", name: "Button Guild" },
        guildId: "guild-btn-test",
        user: { id: "user-regular", tag: "user#0001" },
        deferUpdate: async () => {},
        update: async (payload: any) => {
          updatedPayload = payload;
        },
      };

      await handleInteraction(mockButtonInteraction);
      expect(updatedPayload).toBeDefined();
      expect(updatedPayload.components).toBeDefined();
      const footer = getContainerText(updatedPayload);
      expect(footer).toContain("Proposal 2 of 2");
    });

    it("blocks non-admin users from carousel approve/reject buttons", async () => {
      const p = db.createProposal({
        guildId: "guild-perm-test",
        userId: "user-1",
        name: "Security Proposal",
      });

      let repliedPayload: any = null;
      const nonAdminInteraction: any = {
        isChatInputCommand: () => false,
        isButton: () => true,
        isModalSubmit: () => false,
        isStringSelectMenu: () => false,
        customId: `rebrand_prop_approve:${p.id}:0`,
        guild: { id: "guild-perm-test", ownerId: "admin-owner" },
        guildId: "guild-perm-test",
        user: { id: "regular-user", tag: "regular#0001" },
        memberPermissions: { has: () => false },
        reply: async (payload: any) => {
          repliedPayload = payload;
        },
      };

      await handleInteraction(nonAdminInteraction);
      expect(repliedPayload).toBeDefined();
      expect(getContainerText(repliedPayload)).toContain("Permission Denied");
    });

    it("allows administrators to initiate approval confirmation from carousel", async () => {
      const p = db.createProposal({
        guildId: "guild-perm-test-2",
        userId: "user-1",
        name: "Admin Approved Proposal",
      });

      let repliedPayload: any = null;
      const adminInteraction: any = {
        isChatInputCommand: () => false,
        isButton: () => true,
        isModalSubmit: () => false,
        isStringSelectMenu: () => false,
        customId: `rebrand_prop_approve:${p.id}:0`,
        guild: { id: "guild-perm-test-2", ownerId: "admin-owner" },
        guildId: "guild-perm-test-2",
        user: { id: "admin-owner", tag: "admin#0001" },
        memberPermissions: { has: () => true },
        reply: async (payload: any) => {
          repliedPayload = payload;
        },
      };

      await handleInteraction(adminInteraction);
      expect(repliedPayload).toBeDefined();
      expect(getContainerText(repliedPayload)).toContain("Confirm Approval");
      const btn = (repliedPayload.components[0].components as any[])
        .flatMap((c: any) => c.components || [])
        .find((b: any) => b.data?.custom_id?.startsWith("rebrand_confirm_approve"));
      expect(btn?.data?.custom_id).toBe(`rebrand_confirm_approve:${p.id}`);
    });
  });
});
