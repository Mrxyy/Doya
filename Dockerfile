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
RUN npm run build:web --workspace=@getdoya/app

FROM node:22.20.0-bookworm AS server

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates git openssh-client \
  && rm -rf /var/lib/apt/lists/*

ENV DOYA_HOME=/data/doya
ENV DOYA_LISTEN=0.0.0.0:6767
ENV DOYA_NODE_ENV=production
ENV DOYA_RELAY_ENABLED=0
ENV NODE_ENV=production

COPY --from=build /app /app

EXPOSE 6767

CMD ["npm", "run", "start", "--workspace=@getdoya/server"]

FROM node:22.20.0-bookworm AS control

WORKDIR /app

ENV DOYA_CONTROL_HOME=/data/control
ENV DOYA_CONTROL_HOST=0.0.0.0
ENV DOYA_CONTROL_PORT=6777
ENV NODE_ENV=production

COPY --from=build /app /app

EXPOSE 6777

CMD ["node", "packages/control/dist/server.js"]

FROM nginx:1.27-alpine AS app

COPY docker/nginx-app.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/packages/app/dist /usr/share/nginx/html

EXPOSE 80
