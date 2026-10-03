import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  aboutCommand,
  handleAboutCommand,
} from "../src/commands/about";
import { commands } from "../src/commands";
import { RebrandDatabase, setDatabase } from "../src/database";
import {
  getVersionInfo,
  getCommitHash,
  getShortCommitHash,
  getRepoUrl,
  getCommitUrl,
  setCachedCommitHashForTesting,
} from "../src/utils/version";
import { getContainerText } from "../src/services/announcement";
import fs from "fs";
import path from "path";

describe("/about command & metadata", () => {
  const testDbPath = path.resolve(process.cwd(), "data", "test_about.sqlite");
  let testDb: RebrandDatabase;

  beforeEach(() => {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    testDb = new RebrandDatabase(testDbPath);
    setDatabase(testDb);
  });

  afterEach(() => {
    testDb.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    setCachedCommitHashForTesting(null);
  });

  describe("version & git metadata utilities", () => {
    it("retrieves commit hash and generates short hash and commit URL", () => {
      setCachedCommitHashForTesting("abcdef1234567890abcdef1234567890abcdef12");
      expect(getCommitHash()).toBe("abcdef1234567890abcdef1234567890abcdef12");
      expect(getShortCommitHash()).toBe("abcdef1");
      expect(getRepoUrl()).toContain("github.com/mambucodev/rebrandr-discord");
      expect(getCommitUrl()).toBe(
        "https://github.com/mambucodev/rebrandr-discord/commit/abcdef1234567890abcdef1234567890abcdef12"
      );

      const info = getVersionInfo();
      expect(info.version).toBeDefined();
      expect(info.shortCommitHash).toBe("abcdef1");
      expect(info.repoUrl).toBe("https://github.com/mambucodev/rebrandr-discord");
    });

    it("handles unknown commit hash gracefully", () => {
      setCachedCommitHashForTesting("unknown");
      expect(getCommitHash()).toBe("unknown");
      expect(getShortCommitHash()).toBe("unknown");
      expect(getCommitUrl()).toBeNull();
    });
  });

  describe("database.getStats()", () => {
    it("returns zero counts on empty database", () => {
      const stats = testDb.getStats();
      expect(stats.totalProposals).toBe(0);
      expect(stats.pendingProposals).toBe(0);
      expect(stats.approvedProposals).toBe(0);
      expect(stats.completedProposals).toBe(0);
      expect(stats.totalVotes).toBe(0);
      expect(stats.configuredGuilds).toBe(0);
    });

    it("accurately tallies proposals across multiple statuses and votes", () => {
      testDb.updateGuildSettings("guild-stats-1", { forum_channel_id: "forum-1" });
      testDb.updateGuildSettings("guild-stats-2", { forum_channel_id: "forum-2" });

      const p1 = testDb.createProposal({
        guildId: "guild-stats-1",
        userId: "user-1",
        name: "Neon Nights",
      });
      const p2 = testDb.createProposal({
        guildId: "guild-stats-1",
        userId: "user-2",
        name: "Retro Synth",
      });
      const p3 = testDb.createProposal({
        guildId: "guild-stats-2",
        userId: "user-3",
        name: "Pastel Spring",
      });

      testDb.approveProposal(p1.id, "admin-1");
      testDb.setVotesForProposal(p1.id, ["u1", "u2", "u3"], []);
      testDb.setVotesForProposal(p2.id, ["u4"], ["u5"]);

      const stats = testDb.getStats();
      expect(stats.totalProposals).toBe(3);
      expect(stats.approvedProposals).toBe(1);
      expect(stats.pendingProposals).toBe(2);
      expect(stats.totalVotes).toBe(5);
      expect(stats.configuredGuilds).toBe(2);

      const guild1Stats = testDb.getStats("guild-stats-1");
      expect(guild1Stats.totalProposals).toBe(2);
      expect(guild1Stats.approvedProposals).toBe(1);
      expect(guild1Stats.pendingProposals).toBe(1);
      expect(guild1Stats.totalVotes).toBe(5);
    });
  });

  describe("handleAboutCommand", () => {
    it("is registered in the commands registry", () => {
      const found = commands.find((cmd) => cmd.name === "about");
      expect(found).toBeDefined();
      expect(found?.name).toBe("about");
    });

    it("renders rich about container with statistics, commit hash, and repo link", async () => {
      setCachedCommitHashForTesting("125c4e7745b0a8a22ef0cb005ac27726ea10ed08");

      testDb.updateGuildSettings("guild-about-test", { forum_channel_id: "forum-about" });
      testDb.createProposal({
        guildId: "guild-about-test",
        userId: "user-about",
        name: "Pixel Cyberpunk",
      });

      let replyPayload: any = null;
      const mockInteraction: any = {
        commandName: "about",
        guild: {
          id: "guild-about-test",
          name: "Test Rebrand Guild",
        },
        client: {
          user: {
            displayAvatarURL: () => "https://cdn.discordapp.com/icons/test-bot.png",
          },
          guilds: {
            cache: new Map([
              ["guild-about-test", { id: "guild-about-test", memberCount: 150 }],
            ]),
          },
          uptime: 120000,
        },
        reply: async (payload: any) => {
          replyPayload = payload;
          return payload;
        },
      };

      await handleAboutCommand(mockInteraction);

      expect(replyPayload).toBeDefined();
      expect(replyPayload.components).toBeDefined();

      const text = getContainerText(replyPayload);
      expect(text).toContain("Weekend Rebrand");
      expect(text).toContain("Community Activity");
      expect(text).toContain("Total Proposals");
      expect(text).toContain("125c4e7");
      expect(text).toContain("https://github.com/mambucodev/rebrandr-discord");

      // Verify the link action button
      const containerJson = replyPayload.components[0].toJSON();
      const actionRow = containerJson.components.find((c: any) => c.type === 1);
      expect(actionRow).toBeDefined();
      const repoBtn = actionRow.components.find(
        (b: any) => b.label === "Public Repository" && b.url === "https://github.com/mambucodev/rebrandr-discord"
      );
      expect(repoBtn).toBeDefined();
    });
  });
});
