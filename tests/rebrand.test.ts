import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { isUtcWeekend, getCurrentOrNextWeekendSaturday, getNextSaturdayAfter, formatWeekendDate } from "../src/utils/dateUtils";
import { RebrandDatabase } from "../src/database";
import { isUpvoteEmoji, isDownvoteEmoji } from "../src/handlers/threadHandler";
import fs from "fs";
import path from "path";

describe("dateUtils", () => {
  it("correctly identifies UTC weekends", () => {
    const saturday = new Date(Date.UTC(2026, 8, 19, 12, 0, 0));
    const sunday = new Date(Date.UTC(2026, 8, 20, 23, 59, 59));
    const monday = new Date(Date.UTC(2026, 8, 21, 0, 0, 0));
    const friday = new Date(Date.UTC(2026, 8, 18, 23, 59, 59));

    expect(isUtcWeekend(saturday)).toBe(true);
    expect(isUtcWeekend(sunday)).toBe(true);
    expect(isUtcWeekend(monday)).toBe(false);
    expect(isUtcWeekend(friday)).toBe(false);
  });

  it("calculates current or next weekend Saturday date", () => {
    const tuesday = new Date(Date.UTC(2026, 8, 15, 10, 0, 0));
    expect(getCurrentOrNextWeekendSaturday(tuesday)).toBe("2026-09-19");

    const saturday = new Date(Date.UTC(2026, 8, 19, 15, 30, 0));
    expect(getCurrentOrNextWeekendSaturday(saturday)).toBe("2026-09-19");

    const sunday = new Date(Date.UTC(2026, 8, 20, 8, 0, 0));
    expect(getCurrentOrNextWeekendSaturday(sunday)).toBe("2026-09-19");
  });

  it("calculates consecutive Saturdays", () => {
    expect(getNextSaturdayAfter("2026-09-19")).toBe("2026-09-26");
    expect(getNextSaturdayAfter("2026-09-26")).toBe("2026-10-03");
  });

  it("formats weekend dates nicely", () => {
    const formatted = formatWeekendDate("2026-09-19");
    expect(formatted).toContain("Sep 19, 2026");
    expect(formatted).toContain("Saturday");
  });
});

describe("RebrandDatabase", () => {
  const testDbPath = path.resolve(process.cwd(), "data", "test_rebrand.sqlite");
  let db: RebrandDatabase;

  beforeEach(() => {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    db = new RebrandDatabase(testDbPath);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  it("initializes and updates guild settings with forum channel, rebrand tag, and logs channel", () => {
    const settings = db.getGuildSettings("guild-123");
    expect(settings.guild_id).toBe("guild-123");
    expect(settings.min_upvotes).toBe(4);

    const updated = db.updateGuildSettings("guild-123", {
      logs_channel_id: "chan-logs",
      forum_channel_id: "forum-123",
      rebrand_tag_id: "tag-rebrand-789",
      min_upvotes: 4,
      default_name: "Original Server Name",
    });

    expect(updated.logs_channel_id).toBe("chan-logs");
    expect(updated.forum_channel_id).toBe("forum-123");
    expect(updated.rebrand_tag_id).toBe("tag-rebrand-789");
    expect(updated.min_upvotes).toBe(4);
    expect(updated.default_name).toBe("Original Server Name");
  });

  it("handles proposals lifecycle, modal detail updates, and suggestion flow", () => {
    const proposal = db.createProposal({
      guildId: "guild-123",
      userId: "user-456",
      threadId: "thread-789",
    });

    expect(proposal.id).toBeDefined();
    expect(proposal.status).toBe("pending");
    expect(proposal.thread_id).toBe("thread-789");
    expect(proposal.is_ready).toBe(0);

    const updatedProposal = db.updateProposalDetails(proposal.id, {
      name: "Cyberpunk Weekend",
      icon_url: "https://example.com/icon.png",
      topic: "Neon city aesthetic",
    });
    expect(updatedProposal?.name).toBe("Cyberpunk Weekend");
    expect(updatedProposal?.is_ready).toBe(1);

    const suggestion = db.createSuggestion({
      proposalId: proposal.id,
      userId: "user-contributor",
      name: "Retro Synth Rebrand",
      iconUrl: "https://example.com/synth.png",
      topic: "Synthwave theme",
    });
    expect(suggestion.id).toBeDefined();
    expect(suggestion.status).toBe("pending");

    db.updateSuggestionStatus(suggestion.id, "accepted");
    const fetchedSug = db.getSuggestion(suggestion.id);
    expect(fetchedSug?.status).toBe("accepted");

    db.setVotesForProposal(proposal.id, ["user-1", "user-2", "user-3", "user-4"], ["user-5"]);
    const counts = db.getVoteCounts(proposal.id);
    expect(counts.upvotes).toBe(4);
    expect(counts.downvotes).toBe(1);
    expect(counts.netVotes).toBe(3);

    const approved = db.approveProposal(proposal.id, "admin-999");
    expect(approved?.status).toBe("approved");
    expect(approved?.scheduled_date).toBeDefined();
    expect(approved?.approved_by).toBe("admin-999");
  });

  it("detects upvote and downvote emojis accurately", () => {
    expect(isUpvoteEmoji("⬆️")).toBe(true);
    expect(isUpvoteEmoji("⬆")).toBe(true);
    expect(isUpvoteEmoji("👍")).toBe(true);
    expect(isUpvoteEmoji("🔺")).toBe(true);
    expect(isUpvoteEmoji("arrow_up")).toBe(true);
    expect(isUpvoteEmoji("random_emoji")).toBe(false);

    expect(isDownvoteEmoji("⬇️")).toBe(true);
    expect(isDownvoteEmoji("⬇")).toBe(true);
    expect(isDownvoteEmoji("👎")).toBe(true);
    expect(isDownvoteEmoji("🔻")).toBe(true);
    expect(isDownvoteEmoji("arrow_down")).toBe(true);
    expect(isDownvoteEmoji("random_emoji")).toBe(false);
  });
});
