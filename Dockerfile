# ============================
# Stage 1: Build the client
# ============================
FROM oven/bun:1.3-alpine AS builder

WORKDIR /app

# Only the client is built here; its output goes to ../dist
COPY client/package.json client/bun.lock ./client/
RUN cd client && bun install --frozen-lockfile
COPY client ./client
RUN cd client && bun run build


# ============================
# Stage 2: Production
# ============================
FROM oven/bun:1.3-alpine

WORKDIR /app

# Install system deps
RUN apk add --no-cache tzdata curl
ENV TZ=Asia/Kuala_Lumpur

# Only install production deps for the backend (sharp ships a musl build for Alpine)
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

# Copy backend. Secrets are NOT baked in: pass them at run time, e.g.
#   docker run --env-file .env -p 5000:5000 -v ezcert-uploads:/app/uploads ezcert
COPY src ./src
COPY ecosystem.config.js ./

# Copy built client bundle
COPY --from=builder /app/dist ./dist

# Uploaded logos/backgrounds: keep this on a volume or they are lost with the container
ENV UPLOAD_DIR=/app/uploads
RUN mkdir -p /app/uploads
VOLUME /app/uploads

# Install PM2 globally using Bun
RUN bun add -g pm2

EXPOSE 5000

# Any HTTP answer means the API is up (curl only fails on connection errors)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3   CMD curl -s -o /dev/null http://localhost:5000/api/v1/events/00000000-0000-4000-8000-000000000000 || exit 1

CMD ["bun", "start"]
