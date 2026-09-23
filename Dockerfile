# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
ARG AUDIOBRAIN_BASE_PATH=/audiobrain/
ARG AUDIOBRAIN_COMMIT
ENV AUDIOBRAIN_BASE_PATH=${AUDIOBRAIN_BASE_PATH}
ENV AUDIOBRAIN_COMMIT=${AUDIOBRAIN_COMMIT}
RUN npm run build:deploy

FROM nginx:1.27.5-alpine

ARG AUDIOBRAIN_COMMIT
ENV AUDIOBRAIN_COMMIT=${AUDIOBRAIN_COMMIT}
COPY deploy/nginx.conf /etc/nginx/nginx.conf
COPY --chmod=755 deploy/healthcheck.sh /usr/local/bin/audiobrain-healthcheck
COPY --from=build --chown=nginx:nginx /app/dist/ /usr/share/nginx/html/

USER nginx
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=6 \
  CMD ["/usr/local/bin/audiobrain-healthcheck"]
