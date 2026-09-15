import { describe, it, expect } from "bun:test";
import {
  createProposalEmbed,
  createProposalActionRow,
  createSuggestionEmbed,
  createSuggestionActionRow,
  createAdminLogApprovalEmbed,
  createAdminLogActionRow,
  createConfirmationActionRow,
  createErrorEmbed,
  createSuccessEmbed,
  createInfoEmbed,
  hasAdminPermission,
} from "../src/services/announcement";
import type { ProposalWithVotes, Suggestion } from "../src/database";

describe("Announcement Embeds & Action Rows", () => {
  const dummyProposal: ProposalWithVotes = {
    id: 1,
    guild_id: "guild-1",
    thread_id: "thread-1",
    message_id: "msg-1",
    user_id: "user-1",
    name: "Cyberpunk Server",
    icon_url: "https://example.com/icon.png",
    icon_path: null,
    topic: "Neon and glitch theme",
    status: "pending",
    is_ready: 1,
    created_at: new Date().toISOString(),
    scheduled_date: null,
    approved_by: null,
    upvotes_count: 3,
    downvotes_count: 1,
    net_votes: 2,
    vote_count: 2,
  };

  const dummySuggestion: Suggestion = {
    id: 10,
    proposal_id: 1,
    user_id: "suggest-user-1",
    name: "Cyberpunk 2077 Edition",
    icon_url: "https://example.com/suggest.png",
    topic: "Night city vibe",
    status: "pending",
    created_at: new Date().toISOString(),
  };

  it("creates helper embeds with appropriate colors", () => {
    const success = createSuccessEmbed("Success", "Operation worked").toJSON();
    expect(success.color).toBe(0x57f287);
    expect(success.title).toBe("Success");

    const error = createErrorEmbed("Failed", "Operation failed").toJSON();
    expect(error.color).toBe(0xed4245);
    expect(error.title).toBe("Failed");

    const info = createInfoEmbed("Note", "Info message").toJSON();
    expect(info.color).toBe(0x5865f2);
    expect(info.title).toBe("Note");
  });

  it("creates proposal embed and action row with modal trigger button", () => {
    const embed = createProposalEmbed(dummyProposal, 4);
    const data = embed.toJSON();
    expect(data.title).toContain("Proposal #1");
    expect(data.description).toContain("Cyberpunk Server");
    expect(data.fields?.some((f) => f.value.includes("3") && f.value.includes("Up"))).toBe(true);
    expect(data.thumbnail?.url).toBe("https://example.com/icon.png");

    const row = createProposalActionRow(dummyProposal, 4);
    const components = row.components as any[];
    expect(components.length).toBe(3);
    expect(components.some((c) => c.data.custom_id === "rebrand_upload_icon:1")).toBe(true);
    expect(components.some((c) => c.data.custom_id === "rebrand_open_modal:1")).toBe(true);
    expect(components.some((c) => c.data.custom_id === "rebrand_suggest_modal:1")).toBe(true);
  });

  it("creates suggestion embed and accept/reject action row", () => {
    const embed = createSuggestionEmbed(dummySuggestion, dummyProposal);
    const data = embed.toJSON();
    expect(data.title).toContain("New Rebrand Asset Suggestion");
    expect(data.fields?.some((f) => f.value.includes("Cyberpunk 2077"))).toBe(true);

    const row = createSuggestionActionRow(dummySuggestion.id);
    const components = row.components as any[];
    expect(components.length).toBe(2);
    expect(components[0]?.data && "custom_id" in components[0].data ? components[0].data.custom_id : undefined).toBe("rebrand_accept_suggest:10");
    expect(components[1]?.data && "custom_id" in components[1].data ? components[1].data.custom_id : undefined).toBe("rebrand_reject_suggest:10");
  });

  it("creates admin log action row and confirmation row", () => {
    const adminRow = createAdminLogActionRow(5);
    expect(adminRow.components.length).toBe(2);

    const confirmApprove = createConfirmationActionRow("approve", 5);
    expect(confirmApprove.components.length).toBe(2);
    expect((confirmApprove.components[0] as any).data.custom_id).toBe("rebrand_confirm_approve:5");

    const confirmReject = createConfirmationActionRow("reject", 5);
    expect(confirmReject.components.length).toBe(2);
    expect((confirmReject.components[0] as any).data.custom_id).toBe("rebrand_confirm_reject:5");
  });

  it("evaluates admin permissions correctly for owner, Administrator, and Manage Server", () => {
    const mockGuild = { ownerId: "owner-123" };

    const ownerInteraction = {
      guild: mockGuild,
      user: { id: "owner-123" },
      memberPermissions: null,
    } as any;
    expect(hasAdminPermission(ownerInteraction)).toBe(true);

    const nonAdminInteraction = {
      guild: mockGuild,
      user: { id: "normal-user" },
      memberPermissions: {
        has: () => false,
      },
    } as any;
    expect(hasAdminPermission(nonAdminInteraction)).toBe(false);

    const adminPermInteraction = {
      guild: mockGuild,
      user: { id: "admin-user" },
      memberPermissions: {
        has: (bit: any) => true,
      },
    } as any;
    expect(hasAdminPermission(adminPermInteraction)).toBe(true);
  });
});
