import { Client } from "discord.js";
import { database } from "../database";
import { rebrandService } from "./rebrandService";
import { isUtcWeekend, getCurrentOrNextWeekendSaturday } from "../utils/dateUtils";
import { config } from "../config";

export class RebrandScheduler {
  private client: Client | null = null;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private isProcessing: boolean = false;

  public start(client: Client): void {
    this.client = client;
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
    }

    console.log("[Scheduler] Starting Rebrand Scheduler...");
    setTimeout(() => this.tick(), 2000);

    this.intervalTimer = setInterval(() => {
      this.tick();
    }, config.schedulerIntervalMs);
  }

  public stop(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }

  public async tick(): Promise<void> {
    if (!this.client || !this.client.isReady() || this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    try {
      const isWeekendNow = isUtcWeekend();
      const currentSaturdayIso = getCurrentOrNextWeekendSaturday();

      for (const [guildId, guild] of this.client.guilds.cache) {
        let settings = database.getGuildSettings(guildId);

        if (isWeekendNow) {
          // If the bot was offline and an active rebrand is from a past weekend, conclude it first
          if (settings.active_proposal_id) {
            const activeProposal = database.getProposal(settings.active_proposal_id);
            if (activeProposal && activeProposal.scheduled_date && activeProposal.scheduled_date < currentSaturdayIso) {
              console.log(`[Scheduler] Active proposal #${activeProposal.id} was for past weekend (${activeProposal.scheduled_date}). Reverting...`);
              await rebrandService.revertRebrand(guild);
              settings = database.getGuildSettings(guildId);
            }
          }

          if (!settings.active_proposal_id) {
            let proposal = database.getScheduledProposalForDate(guildId, currentSaturdayIso);
            if (!proposal) {
              proposal = database.getNextApprovedProposalInQueue(guildId);
            }

            if (proposal) {
              console.log(`[Scheduler] Weekend active! Applying proposal #${proposal.id} for guild ${guild.name}`);
              await rebrandService.applyRebrand(guild, proposal);
            }
          }
        } else {
          if (settings.active_proposal_id) {
            console.log(`[Scheduler] Weekend ended! Reverting active rebrand for guild ${guild.name}`);
            await rebrandService.revertRebrand(guild);
          }
        }
      }
    } catch (err) {
      console.error("[Scheduler] Error during scheduler tick:", err);
    } finally {
      this.isProcessing = false;
    }
  }
}

export const scheduler = new RebrandScheduler();
