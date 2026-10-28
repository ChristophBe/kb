# The web shell with every module UI compiled in, served by nginx.
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /src
COPY . .
RUN pnpm install --frozen-lockfile --filter "@kb/web..." && pnpm --filter @kb/web build

FROM nginx:1.29-alpine
COPY deploy/docker/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/docker/web/40-runtime-config.sh /docker-entrypoint.d/40-runtime-config.sh
COPY --from=build /src/apps/web/dist /usr/share/nginx/html
