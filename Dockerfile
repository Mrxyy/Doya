# syntax=docker/dockerfile:1

FROM node:22.20.0-bookworm AS build

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates g++ git make python3 \
  && rm -rf /var/lib/apt/lists/*

ENV APP_VARIANT=production
ENV EXPO_NO_TELEMETRY=1
ENV LEFTHOOK=0
ARG EXPO_PUBLIC_LOCAL_DAEMON=localhost:6767
ARG EXPO_PUBLIC_CONTROL_API_URL=http://localhost:6777
ENV EXPO_PUBLIC_LOCAL_DAEMON=${EXPO_PUBLIC_LOCAL_DAEMON}
ENV EXPO_PUBLIC_CONTROL_API_URL=${EXPO_PUBLIC_CONTROL_API_URL}

COPY . .

RUN npm ci --ignore-scripts
RUN npm run postinstall
RUN npm run build:server

FROM build AS app-build

RUN npm run build:web --workspace=@getdoya/app

FROM node:22.20.0-bookworm-slim AS server-deps

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/app/package.json packages/app/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/client/package.json packages/client/package.json
COPY packages/control/package.json packages/control/package.json
COPY packages/desktop/package.json packages/desktop/package.json
COPY packages/expo-two-way-audio/package.json packages/expo-two-way-audio/package.json
COPY packages/highlight/package.json packages/highlight/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/relay/package.json packages/relay/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/website/package.json packages/website/package.json

RUN npm ci --omit=dev --ignore-scripts --include-workspace-root=false \
  && cp -R node_modules/zod-to-json-schema packages/server/node_modules/zod-to-json-schema

FROM node:22.20.0-bookworm-slim AS control-deps

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/control/package.json packages/control/package.json

RUN npm ci --omit=dev --ignore-scripts --include-workspace-root=false \
  --workspace=@getdoya/control \
  && npm install --omit=dev --ignore-scripts zod@^3.23.8

FROM node:22.20.0-bookworm-slim AS server

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates git openssh-client procps \
  && rm -rf /var/lib/apt/lists/*

ENV DOYA_HOME=/data/doya
ENV DOYA_LISTEN=0.0.0.0:6767
ENV DOYA_NODE_ENV=production
ENV DOYA_RELAY_ENABLED=0
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY --from=server-deps /app/node_modules ./node_modules
COPY --from=server-deps /app/packages/client/node_modules ./packages/client/node_modules
COPY --from=server-deps /app/packages/protocol/node_modules ./packages/protocol/node_modules
COPY --from=server-deps /app/packages/server/node_modules ./packages/server/node_modules
COPY --from=build /app/packages/client/package.json ./packages/client/package.json
COPY --from=build /app/packages/client/dist ./packages/client/dist
COPY --from=build /app/packages/highlight/package.json ./packages/highlight/package.json
COPY --from=build /app/packages/highlight/dist ./packages/highlight/dist
COPY --from=build /app/packages/protocol/package.json ./packages/protocol/package.json
COPY --from=build /app/packages/protocol/dist ./packages/protocol/dist
COPY --from=build /app/packages/relay/package.json ./packages/relay/package.json
COPY --from=build /app/packages/relay/dist ./packages/relay/dist
COPY --from=build /app/packages/server/package.json ./packages/server/package.json
COPY --from=build /app/packages/server/dist ./packages/server/dist

EXPOSE 6767

CMD ["node", "packages/server/dist/scripts/supervisor-entrypoint.js"]

FROM node:22.20.0-bookworm-slim AS control

WORKDIR /app

ENV DOYA_CONTROL_HOME=/data/control
ENV DOYA_CONTROL_HOST=0.0.0.0
ENV DOYA_CONTROL_PORT=6777
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY --from=control-deps /app/node_modules ./node_modules
COPY --from=build /app/packages/control/package.json ./packages/control/package.json
COPY --from=build /app/packages/control/dist ./packages/control/dist

EXPOSE 6777

CMD ["node", "packages/control/dist/server.js"]

FROM nginx:1.27-alpine AS app

COPY docker/nginx-app.conf /etc/nginx/conf.d/default.conf
COPY --from=app-build /app/packages/app/dist /usr/share/nginx/html

EXPOSE 80
