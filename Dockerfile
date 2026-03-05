FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --include=optional --no-audit --no-fund

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3333
ENV OPENCLAW_HOME=/openclaw
ENV OPENCLAW_WORKSPACE=/openclaw/workspace
ENV OPENCLAW_TRANSPORT=http
ENV OPENCLAW_GATEWAY_URL=http://host.docker.internal:18789

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --include=optional --no-audit --no-fund

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts

RUN mkdir -p /openclaw && chown -R node:node /app /openclaw
USER node

EXPOSE 3333
CMD ["sh", "-c", "npm run start -- -H 0.0.0.0 -p ${PORT}"]
