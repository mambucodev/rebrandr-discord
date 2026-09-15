# Deploying Weekend Rebrand Bot on Coolify

This guide walks you through deploying the bot on **Coolify** using Docker.

---

## Deployment Options in Coolify

You can deploy the bot using either **Dockerfile** or **Docker Compose**.

### Option 1: Dockerfile Deployment (Recommended)

1. In your Coolify dashboard, navigate to your Project/Environment and click **+ New Resource**.
2. Choose **Public Repository** or **Private Repository** and link your Git repository containing this bot.
3. Under **Build Pack**, select **Dockerfile**.
4. In **Configuration**:
   - **Exposed Port**: `3000` (used for the internal `/health` status endpoint).
5. Add **Environment Variables**:
   - `DISCORD_TOKEN`: Your bot token from the [Discord Developer Portal](https://discord.com/developers/applications).
6. Configure **Persistent Storage** (Crucial):
   - Go to the **Storages** tab.
   - Click **Add Persistent Storage**.
   - Set **Destination / Mount Path**: `/app/data`
   - Set **Volume Name**: `rebrand-data`
   *(This ensures your SQLite database and cached server icons persist across redeploys!)*
7. Under **Health Checks**:
   - Health Check Path: `/health`
   - Port: `3000`
8. Click **Deploy**.

---

### Option 2: Docker Compose Deployment

1. In Coolify, select **+ New Resource** -> **Docker Compose**.
2. Select your repository (or paste the contents of `docker-compose.yml`).
3. Add `DISCORD_TOKEN` under **Environment Variables**.
4. Click **Deploy**. The `rebrand_data` named volume will automatically be created and attached to `/app/data`.

---

## Environment Variables Reference

| Variable | Description | Default |
| :--- | :--- | :--- |
| `DISCORD_TOKEN` | Discord Bot Token (**Required**) | — |
| `DATABASE_PATH` | Path to SQLite database file | `/app/data/rebrand.sqlite` |
| `ICONS_DIR` | Directory to store validated icon buffers | `/app/data/icons` |
| `PORT` | HTTP port for health checks | `3000` |
| `ENABLE_HEALTH_SERVER` | Enable internal health check server (`true`/`false`) | `true` |
| `DEFAULT_MIN_UPVOTES` | Default required net upvotes if not configured per-guild | `4` |
| `SCHEDULER_INTERVAL_MS` | Frequency of weekend check loop in milliseconds | `30000` (30s) |

---

## Discord Developer Portal Settings

Make sure the following **Privileged Gateway Intents** are enabled under your bot's settings in Discord Developer Portal:
- ✅ **Server Members Intent** (Optional, but recommended)
- ✅ **Message Content Intent** (Required for detecting uploaded icon attachments in forum posts and threads)
