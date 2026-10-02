# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Build stage — compile TypeScript to dist/
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------------------------------------------------------------------------
# Runtime stage — production dependencies + compiled output only
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime

ENV NODE_ENV=production \
    ARCANE_HTTP_HOST=0.0.0.0 \
    ARCANE_HTTP_PORT=3000

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Optional tool-filter config lives at ~/.arcane/config.json (hot-reloaded).
# Pre-create the directory so a bind mount lands with the right ownership.
RUN mkdir -p /home/node/.arcane && chown node:node /home/node/.arcane

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.ARCANE_HTTP_PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Default: HTTP (Streamable) transport on :3000/mcp.
# For stdio, override the command: `docker run -i --rm ... arcane-mcp-server --stdio`
ENTRYPOINT ["node", "dist/index.js"]
CMD ["--tcp"]
