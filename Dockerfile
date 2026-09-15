FROM oven/bun:1-slim AS base
WORKDIR /app

# Install production dependencies
FROM base AS dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Final runtime image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV DATABASE_PATH=/app/data/rebrand.sqlite
ENV ICONS_DIR=/app/data/icons
ENV PORT=3000

# Ensure persistent directories exist
RUN mkdir -p /app/data/icons

# Copy production node_modules and application code
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY index.ts ./

# Volume mount point for SQLite database and downloaded server icons
VOLUME ["/app/data"]

# Internal HTTP health check port
EXPOSE 3000

# Health check using Bun's native HTTP fetch
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["bun", "run", "index.ts"]
