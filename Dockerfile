# KubeDeck web mode — the shared-service build. See docs/WEB.md.
# (No HEALTHCHECK on purpose: liveness/readiness belong to the pod spec in deploy/kubernetes.)

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
ARG KUBECTL_VERSION=v1.31.4
RUN apk add --no-cache curl \
 && arch="$(uname -m | sed 's/x86_64/amd64/; s/aarch64/arm64/')" \
 && curl -fsSLo /usr/local/bin/kubectl "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${arch}/kubectl" \
 && chmod +x /usr/local/bin/kubectl \
 && apk del curl
WORKDIR /app
ENV NODE_ENV=production \
    KUBEDECK_MODE=web \
    PORT=5000
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 5000
CMD ["node", "dist/index.cjs"]
