# Weekend Rebrand Bot 🎨

An automated Discord bot that manages **community-driven weekend rebrands** for your server (UTC+0).

Every weekend (Saturday 00:00 UTC to Sunday 23:59 UTC / Monday 00:00 UTC), the bot automatically updates the server's name and icon based on community proposals and restores the server back to its default state when the weekend ends.

---

## ✨ Features

- **Propose Rebrands**: Members submit new server names, custom icon images, and themes via `/propose`.
- **Interactive Voting**: Proposal cards with interactive `👍 Upvote` buttons, displaying real-time vote progress.
- **Server Owner Approval**: Once the upvote threshold is reached (or anytime), the server owner can approve via the `👑 Approve` button or `/rebrand approve`.
- **Automated Scheduling**: Approved proposals are automatically queued for upcoming weekend dates (UTC+0).
- **Automated Apply & Revert**:
  - **Saturday 00:00 UTC**: Server name & icon are changed, and an announcement is posted.
  - **Monday 00:00 UTC**: Server name & icon are reverted back to baseline defaults, with a conclusion announcement.
- **Local Asset Caching**: Proposed and default server icons are safely cached locally (`data/icons/`) in SQLite (`bun:sqlite`).
- **Admin & Manual Overrides**: Commands to configure channels, set default baselines, force-apply, force-revert, or cancel proposals.

---

## 🚀 Slash Commands

### Community Commands
- `/propose <name> <icon> [topic]` — Propose a new weekend rebrand.
- `/schedule` — View active and upcoming scheduled weekend rebrands.
- `/proposals` — List pending proposals waiting for upvotes/approval.

### Admin / Owner Commands (`/rebrand`)
- `/rebrand config [announcement_channel] [proposals_channel] [min_upvotes]` — Configure announcement/proposals channels and upvote requirement (default: 5).
- `/rebrand status` — View current bot configuration, baseline backup, and queue.
- `/rebrand set-default [name] [icon]` — Set or capture the default baseline server name & icon.
- `/rebrand approve <id>` — Approve a proposal and schedule it for an upcoming weekend.
- `/rebrand reject <id> [reason]` — Reject a proposal.
- `/rebrand apply <id>` — Manually apply a rebrand right now (force rebrand).
- `/rebrand revert` — Manually revert back to default server name and icon immediately.
- `/rebrand cancel <id>` — Cancel a scheduled proposal.

---

## 🛠️ Installation & Setup

1. **Install dependencies**:
   ```bash
   bun install
   ```

2. **Configure `.env`**:
   ```env
   DISCORD_TOKEN=your_bot_token_here
   ```

3. **Run the bot**:
   ```bash
   bun start
   ```

4. **Run tests**:
   ```bash
   bun test
   ```

---

## 🛡️ Discord Permissions Needed

Ensure the bot has a role with:
- **Manage Server (`ManageGuild`)** — Needed to change server name and icon.
- **Send Messages & Embed Links** — Needed to post proposals and announcements.
- **Attach Files** — Needed for embeds and icons.
