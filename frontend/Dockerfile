# syntax=docker/dockerfile:1
#
# FleetPulse UI. Built with Next's standalone output so the final image carries
# a server and the handful of packages it actually imports, not the whole of
# node_modules.

FROM node:22-alpine AS deps
WORKDIR /app
# The prompt would block a non-interactive build when corepack fetches pnpm.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile


FROM node:22-alpine AS builder
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* values are inlined into the bundle at build time, so this has to
# be a build argument rather than a runtime variable. "/api" is relative on
# purpose: the browser asks the same origin it loaded the page from, which means
# this image carries no hostname and works behind any domain you point at it.
ARG NEXT_PUBLIC_API_URL=/api
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm build


FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -g 10002 -S nodejs && adduser -S nextjs -u 10002 -G nodejs

# public/ is not part of the standalone bundle - the icons and images have to
# come across separately or every favicon request 404s.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
