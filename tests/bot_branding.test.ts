import { describe, it, expect, mock } from "bun:test";
import { rebrandService } from "../src/services/rebrandService";

describe("Bot Branding Synchronization (Nickname & PFP)", () => {
  it("sets server-wide nickname to '<server name> Rebrandr' via editMe", async () => {
    let editedOptions: any = null;

    const mockGuild: any = {
      id: "guild-brand-1",
      name: "Snug Nook",
      iconURL: () => null,
      members: {
        me: { nickname: null },
        editMe: mock(async (options: any) => {
          editedOptions = options;
          return {};
        }),
      },
      client: { user: { setAvatar: mock(async () => {}) } },
    };

    await rebrandService.syncBotBranding(mockGuild);

    expect(mockGuild.members.editMe).toHaveBeenCalled();
    expect(editedOptions.nick).toBe("Snug Nook Rebrandr");
  });

  it("truncates base name if nickname would exceed Discord's 32 character limit", async () => {
    let editedOptions: any = null;

    const longGuildName = "Super Long Community Server Name 123456789";
    const mockGuild: any = {
      id: "guild-brand-2",
      name: longGuildName,
      iconURL: () => null,
      members: {
        me: { nickname: null },
        editMe: mock(async (options: any) => {
          editedOptions = options;
          return {};
        }),
      },
      client: { user: { setAvatar: mock(async () => {}) } },
    };

    await rebrandService.syncBotBranding(mockGuild);

    expect(mockGuild.members.editMe).toHaveBeenCalled();
    expect(editedOptions.nick.length).toBeLessThanOrEqual(32);
    expect(editedOptions.nick.endsWith(" Rebrandr")).toBe(true);
  });

  it("skips updating nickname if already set to target nickname", async () => {
    const editMeMock = mock(async () => ({}));
    const mockGuild: any = {
      id: "guild-brand-3",
      name: "Snug Nook",
      iconURL: () => null,
      members: {
        me: { nickname: "Snug Nook Rebrandr" },
        editMe: editMeMock,
      },
      client: { user: { setAvatar: mock(async () => {}) } },
    };

    await rebrandService.syncBotBranding(mockGuild);

    expect(editMeMock).not.toHaveBeenCalled();
  });

  it("updates pfp using provided buffer or server icon, falling back to global avatar if server avatar fails", async () => {
    let globalAvatarBuffer: Buffer | null = null;
    const testIconBuf = Buffer.from("fake-image-data");

    const mockGuild: any = {
      id: "guild-brand-4",
      name: "Snug Nook",
      iconURL: () => null,
      members: {
        me: { nickname: "Snug Nook Rebrandr" },
        editMe: mock(async (options: any) => {
          if (options.avatar) {
            // Simulate Discord error (e.g. guild not boosted or nitro needed)
            throw new Error("Cannot edit server avatar");
          }
          return {};
        }),
      },
      client: {
        user: {
          setAvatar: mock(async (buf: Buffer) => {
            globalAvatarBuffer = buf;
          }),
        },
      },
    };

    await rebrandService.syncBotBranding(mockGuild, undefined, testIconBuf);

    expect(mockGuild.client.user.setAvatar).toHaveBeenCalled();
    expect(globalAvatarBuffer).toEqual(testIconBuf);
  });
});
