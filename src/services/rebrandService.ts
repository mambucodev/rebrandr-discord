import { Guild, TextChannel, ChannelType, Message, ActionRowBuilder, ButtonBuilder } from "discord.js";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { database } from "../database";
import type { Proposal, ProposalWithVotes, GuildSettings } from "../database";
import { config } from "../config";
import { validateImageBuffer } from "../utils/imageUtils";
import {
  createRebrandLiveEmbed,
  createRebrandConcludedEmbed,
  createAdminLogApprovalEmbed,
  createAdminLogActionRow,
  toContainerPayload,
  type ContainerPayloadOptions,
} from "./announcement";

export class RebrandService {
  private lastSyncedGuildAvatarHash = new Map<string, string>();
  private lastSyncedGlobalAvatarHash: string | null = null;
  /**
   * Downloads an image, validates its format and magic bytes locally, and caches it to disk.
   */
  public async downloadAndCacheImage(url: string, filenamePrefix: string): Promise<{ filePath: string; buffer: Buffer }> {
    if (!fs.existsSync(config.iconsDir)) {
      fs.mkdirSync(config.iconsDir, { recursive: true });
    }

    console.log(`[RebrandService] Downloading image from ${url}...`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download image from ${url}: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Validate image format, integrity, and magic bytes locally
    const validation = validateImageBuffer(buffer);
    if (!validation.valid) {
      console.error(`[RebrandService] Image validation failed for ${url}: ${validation.error}`);
      throw new Error(validation.error || "Invalid image format.");
    }

    const ext = validation.ext || "png";
    const fileName = `${filenamePrefix}_${Date.now()}.${ext}`;
    const filePath = path.join(config.iconsDir, fileName);
    fs.writeFileSync(filePath, buffer);
    console.log(`[RebrandService] Validated (${validation.mimeType}) and saved local cache to ${filePath} (${buffer.length} bytes)`);

    return { filePath, buffer };
  }

  public async ensureDefaultBackup(guild: Guild): Promise<GuildSettings> {
    const settings = database.getGuildSettings(guild.id);
    let defaultName = settings.default_name;
    let defaultIconUrl = settings.default_icon_url;
    let defaultIconPath = settings.default_icon_path;

    if (!defaultName) {
      defaultName = guild.name;
    }

    if (!defaultIconPath && guild.iconURL()) {
      defaultIconUrl = guild.iconURL({ size: 1024, extension: "png" });
      if (defaultIconUrl) {
        try {
          const { filePath } = await this.downloadAndCacheImage(defaultIconUrl, `default_${guild.id}`);
          defaultIconPath = filePath;
        } catch (err) {
          console.error(`[RebrandService] Could not cache default guild icon for ${guild.id}:`, err);
        }
      }
    }

    return database.updateGuildSettings(guild.id, {
      default_name: defaultName,
      default_icon_url: defaultIconUrl,
      default_icon_path: defaultIconPath,
    });
  }

  /**
   * Reads the validated local image file and uploads it directly to Discord's server icon endpoint.
   */
  public async applyRebrand(guild: Guild, proposal: Proposal, isManual: boolean = false): Promise<boolean> {
    console.log(`[RebrandService] Applying rebrand #${proposal.id} ('${proposal.name}') to guild "${guild.name}" (${guild.id})`);

    try {
      await this.ensureDefaultBackup(guild);

      let iconBuffer: Buffer | null = null;
      // Prefer reading directly from local validated file
      if (proposal.icon_path && fs.existsSync(proposal.icon_path)) {
        iconBuffer = fs.readFileSync(proposal.icon_path);
        const check = validateImageBuffer(iconBuffer);
        if (!check.valid) {
          console.warn(`[RebrandService] Cached file ${proposal.icon_path} is invalid: ${check.error}`);
          iconBuffer = null;
        }
      }

      // If no local file yet but URL is stored, download, validate, and cache locally first
      if (!iconBuffer && proposal.icon_url) {
        try {
          const { buffer, filePath } = await this.downloadAndCacheImage(proposal.icon_url, `rebrand_${proposal.id}`);
          iconBuffer = buffer;
          database.updateProposalDetails(proposal.id, { icon_path: filePath });
        } catch (err) {
          console.error(`[RebrandService] Error downloading/validating rebrand icon:`, err);
        }
      }

      const auditReason = `Weekend Rebrand #${proposal.id}: ${proposal.topic || proposal.name}${isManual ? " (Manual Override)" : ""}`;
      try {
        await guild.setName(proposal.name, auditReason);
        console.log(`[RebrandService] Guild name changed to "${proposal.name}"`);
      } catch (err) {
        console.error(`[RebrandService] Failed to update guild name:`, err);
      }

      // Upload the local image buffer to Discord
      if (iconBuffer) {
        try {
          await guild.setIcon(iconBuffer, auditReason);
          console.log(`[RebrandService] Uploaded local icon to Discord server icon successfully`);
        } catch (err) {
          console.error(`[RebrandService] Failed to upload icon to Discord:`, err);
        }
      } else {
        console.warn(`[RebrandService] No valid icon buffer found for proposal #${proposal.id}; icon unchanged`);
      }

      database.updateProposalDetails(proposal.id, { is_ready: 1 });
      database.updateGuildSettings(guild.id, { active_proposal_id: proposal.id });

      const now = new Date().toISOString();
      (database as any).db?.run("UPDATE proposals SET status = 'active' WHERE id = ?", [proposal.id]);

      const settings = database.getGuildSettings(guild.id);
      const baselineUrl = settings.default_icon_url || guild.iconURL();
      const liveGallery = [baselineUrl, proposal.icon_url].filter(Boolean) as string[];
      await this.sendAdminLog(
        guild,
        createRebrandLiveEmbed(proposal, guild),
        undefined,
        liveGallery.length > 1 ? { galleryImages: liveGallery } : undefined
      );
      await this.syncBotBranding(guild, proposal.name, iconBuffer).catch(() => null);
      return true;
    } catch (err) {
      console.error(`[RebrandService] Fatal error applying rebrand:`, err);
      return false;
    }
  }

  public async revertRebrand(guild: Guild, isManual: boolean = false): Promise<boolean> {
    console.log(`[RebrandService] Reverting rebrand for guild "${guild.name}" (${guild.id})`);
    try {
      const settings = database.getGuildSettings(guild.id);
      const activeProposal = settings.active_proposal_id ? database.getProposal(settings.active_proposal_id) : null;

      const auditReason = `Weekend Rebrand Ended — Reverting to default${isManual ? " (Manual Override)" : ""}`;

      if (settings.default_name) {
        try {
          await guild.setName(settings.default_name, auditReason);
          console.log(`[RebrandService] Guild name restored to "${settings.default_name}"`);
        } catch (err) {
          console.error(`[RebrandService] Failed to revert guild name:`, err);
        }
      }

      if (settings.default_icon_path && fs.existsSync(settings.default_icon_path)) {
        try {
          const iconBuf = fs.readFileSync(settings.default_icon_path);
          await guild.setIcon(iconBuf, auditReason);
          console.log(`[RebrandService] Guild icon uploaded from default cached path`);
        } catch (err) {
          console.error(`[RebrandService] Failed to revert guild icon from path:`, err);
        }
      } else if (settings.default_icon_url) {
        try {
          const { buffer } = await this.downloadAndCacheImage(settings.default_icon_url, `revert_${guild.id}`);
          await guild.setIcon(buffer, auditReason);
          console.log(`[RebrandService] Guild icon restored from URL`);
        } catch (err) {
          console.error(`[RebrandService] Failed to revert guild icon from url:`, err);
        }
      } else {
        try {
          await guild.setIcon(null, auditReason);
          console.log(`[RebrandService] Guild icon cleared to default`);
        } catch (err) {
          console.error(`[RebrandService] Failed to clear guild icon:`, err);
        }
      }

      if (activeProposal) {
        (database as any).db?.run("UPDATE proposals SET status = 'completed' WHERE id = ?", [activeProposal.id]);
      }
      database.updateGuildSettings(guild.id, { active_proposal_id: null });

      let revertIconBuf: Buffer | null = null;
      if (settings.default_icon_path && fs.existsSync(settings.default_icon_path)) {
        try { revertIconBuf = fs.readFileSync(settings.default_icon_path); } catch {} 
      }
      await this.syncBotBranding(guild, settings.default_name || guild.name, revertIconBuf).catch(() => null);

      const defaultIconUrl = settings.default_icon_url || guild.iconURL();
      const concludedGallery = [activeProposal?.icon_url, defaultIconUrl].filter(Boolean) as string[];
      await this.sendAdminLog(
        guild,
        createRebrandConcludedEmbed(activeProposal, guild),
        undefined,
        concludedGallery.length > 1 ? { galleryImages: concludedGallery } : undefined
      );
      return true;
    } catch (err) {
      console.error(`[RebrandService] Error reverting rebrand:`, err);
      return false;
    }
  }

  public async sendAdminLog(
    guild: Guild,
    embed: any,
    components?: ActionRowBuilder<ButtonBuilder>[],
    options?: ContainerPayloadOptions
  ): Promise<Message | null> {
    const settings = database.getGuildSettings(guild.id);
    let channel: TextChannel | null = null;

    if (settings.logs_channel_id) {
      const fetched = await guild.channels.fetch(settings.logs_channel_id).catch(() => null);
      if (fetched && fetched.type === ChannelType.GuildText) {
        channel = fetched as TextChannel;
      }
    }

    if (channel) {
      try {
        console.log(`[RebrandService] Sending admin log to channel #${channel.name} (${channel.id})`);
        return await channel.send(toContainerPayload(embed, components || [], options));
      } catch (err) {
        console.error(`[RebrandService] Failed to send admin log in channel ${channel.id}:`, err);
      }
    } else {
      console.log(`[RebrandService] No admin logs channel configured for guild "${guild.name}"`);
    }
    return null;
  }

  /**
   * Synchronizes the bot's server-wide nickname to "<server name> Rebrandr"
   * and updates its profile picture (pfp) to match the server's current icon.
   */
  public async syncBotBranding(
    guild: Guild,
    overrideName?: string,
    overrideIconBuffer?: Buffer | null
  ): Promise<void> {
    const baseName = overrideName || guild.name;
    const suffix = " Rebrandr";
    const maxBaseLen = 32 - suffix.length; // 23 characters max to respect Discord's 32-char limit
    const cleanBase = baseName.length > maxBaseLen ? baseName.slice(0, maxBaseLen).trim() : baseName;
    const targetNickname = `${cleanBase}${suffix}`;

    // 1. Sync server-wide nickname
    try {
      const me = guild.members.me || (await guild.members.fetchMe().catch(() => null));
      if (me && me.nickname !== targetNickname) {
        if (typeof (guild.members as any).editMe === "function") {
          await (guild.members as any).editMe({ nick: targetNickname, reason: "Sync server-wide bot nickname" });
        } else if (typeof me.setNickname === "function") {
          await me.setNickname(targetNickname, "Sync server-wide bot nickname");
        }
        console.log(`[BotBranding] Updated nickname in guild "${guild.name}" to "${targetNickname}"`);
      }
    } catch (nickErr) {
      console.warn(`[BotBranding] Could not update nickname in "${guild.name}":`, nickErr);
    }

    // 2. Sync profile picture (PFP) and application icon to match the server's icon
    try {
      let iconBuf: Buffer | null = overrideIconBuffer || null;

      if (!iconBuf) {
        const settings = database.getGuildSettings(guild.id);

        // Priority 1: If an active proposal is running, check if its cached icon exists
        if (settings.active_proposal_id) {
          const activeProp = database.getProposal(settings.active_proposal_id);
          if (activeProp?.icon_path && fs.existsSync(activeProp.icon_path)) {
            try {
              iconBuf = fs.readFileSync(activeProp.icon_path);
            } catch {}
          } else if (activeProp?.icon_url) {
            try {
              const res = await this.downloadAndCacheImage(activeProp.icon_url, `active_pfp_${guild.id}`);
              iconBuf = res.buffer;
            } catch {}
          }
        }

        // Priority 2: Use current server live icon
        if (!iconBuf) {
          const liveIconUrl = guild.iconURL({ extension: "png", size: 1024 });
          if (liveIconUrl) {
            try {
              console.log(`[BotBranding] Downloading server icon for bot PFP from ${liveIconUrl}...`);
              const res = await this.downloadAndCacheImage(liveIconUrl, `pfp_${guild.id}`);
              iconBuf = res.buffer;
            } catch (dlErr) {
              console.warn(`[BotBranding] Failed downloading guild icon for pfp:`, dlErr);
            }
          }
        }

        // Priority 3: Fall back to default baseline backup if no active rebrand and guild has no icon
        if (!iconBuf) {
          if (settings.default_icon_path && fs.existsSync(settings.default_icon_path)) {
            try {
              iconBuf = fs.readFileSync(settings.default_icon_path);
            } catch {}
          } else if (settings.default_icon_url) {
            try {
              const res = await this.downloadAndCacheImage(settings.default_icon_url, `default_pfp_${guild.id}`);
              iconBuf = res.buffer;
            } catch {}
          }
        }
      }

      if (iconBuf) {
        const iconHash = crypto.createHash("md5").update(iconBuf).digest("hex");

        // 2a. Update server-specific member avatar (per-guild pfp)
        if (this.lastSyncedGuildAvatarHash.get(guild.id) !== iconHash) {
          if (typeof (guild.members as any).editMe === "function") {
            try {
              await (guild.members as any).editMe({ avatar: iconBuf, reason: "Sync bot pfp to server icon" });
              this.lastSyncedGuildAvatarHash.set(guild.id, iconHash);
              console.log(`[BotBranding] Updated server avatar in guild "${guild.name}" to match server icon`);
            } catch (memberAvatarErr) {
              console.warn(`[BotBranding] Could not update server member avatar (may require Boost Level or Nitro):`, memberAvatarErr);
            }
          }
        }

        // 2b. Update global bot user avatar and Discord application icon (used in slash command list)
        if (this.lastSyncedGlobalAvatarHash !== iconHash) {
          if (guild.client.user && typeof guild.client.user.setAvatar === "function") {
            try {
              await guild.client.user.setAvatar(iconBuf);
              console.log(`[BotBranding] Updated global bot avatar to match server icon`);
            } catch (globalAvatarErr) {
              console.warn(`[BotBranding] Could not update global bot avatar:`, globalAvatarErr);
            }
          }

          if (guild.client.application && typeof guild.client.application.edit === "function") {
            try {
              await guild.client.application.edit({ icon: iconBuf });
              console.log(`[BotBranding] Updated application icon for slash command autocomplete list`);
            } catch (appErr) {
              console.warn(`[BotBranding] Could not update application icon:`, appErr);
            }
          }

          this.lastSyncedGlobalAvatarHash = iconHash;
        }
      } else if (overrideIconBuffer === null) {
        // Explicitly clearing icon (e.g. reverting to default baseline with no icon)
        const clearHash = "none";
        if (this.lastSyncedGuildAvatarHash.get(guild.id) !== clearHash) {
          if (typeof (guild.members as any).editMe === "function") {
            try {
              await (guild.members as any).editMe({ avatar: null, reason: "Reset bot pfp to none" });
              this.lastSyncedGuildAvatarHash.set(guild.id, clearHash);
            } catch {}
          }
        }
        if (this.lastSyncedGlobalAvatarHash !== clearHash) {
          if (guild.client.user && typeof guild.client.user.setAvatar === "function") {
            try { await guild.client.user.setAvatar(null); } catch {}
          }
          if (guild.client.application && typeof guild.client.application.edit === "function") {
            try { await guild.client.application.edit({ icon: null }); } catch {}
          }
          this.lastSyncedGlobalAvatarHash = clearHash;
        }
      }
    } catch (pfpErr) {
      console.warn(`[BotBranding] Error syncing bot pfp for "${guild.name}":`, pfpErr);
    }
  }

  public async checkAndNotifyAdminLogs(guild: Guild, proposalId: number): Promise<void> {
    const proposal = database.getProposal(proposalId);
    if (!proposal || proposal.status !== "pending") return;

    const settings = database.getGuildSettings(guild.id);
    if (!settings.logs_channel_id) return;

    const isReady = proposal.is_ready === 1 && Boolean(proposal.icon_url || proposal.icon_path);
    const hasEnoughVotes = proposal.upvotes_count >= settings.min_upvotes;

    if (!isReady || !hasEnoughVotes) {
      return;
    }

    console.log(`[RebrandService] Notifying admin logs: Proposal #${proposal.id} reached ${proposal.upvotes_count}/${settings.min_upvotes} upvotes and is ready!`);

    const threadUrl = proposal.thread_id ? `https://discord.com/channels/${guild.id}/${proposal.thread_id}` : undefined;
    const logEmbed = createAdminLogApprovalEmbed(proposal, guild, threadUrl);
    const actionRow = createAdminLogActionRow(proposal.id);

    try {
      const logsChan = (await guild.channels.fetch(settings.logs_channel_id).catch(() => null)) as TextChannel | null;
      if (!logsChan) return;

      if (proposal.log_message_id) {
        const existingMsg = await logsChan.messages.fetch(proposal.log_message_id).catch(() => null);
        if (existingMsg) {
          await existingMsg.edit(toContainerPayload(logEmbed, [actionRow]));
          console.log(`[RebrandService] Updated existing admin log approval card for proposal #${proposal.id}`);
          return;
        }
      }

      const newMsg = await logsChan.send(toContainerPayload(logEmbed, [actionRow]));
      database.updateProposalLogMessage(proposal.id, newMsg.id);
      console.log(`[RebrandService] Sent new admin log approval card ${newMsg.id} for proposal #${proposal.id}`);
    } catch (err) {
      console.error("[RebrandService] Error sending approval prompt to logs channel:", err);
    }
  }
}

export const rebrandService = new RebrandService();
