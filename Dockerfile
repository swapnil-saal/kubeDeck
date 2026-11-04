# KubeDeck web mode — the shared-service build. See docs/WEB.md.
# (No HEALTHCHECK on purpose: liveness/readiness belong to the pod spec in deploy/kubernetes.)

# the bundle is plain JavaScript: build it once on the host's own platform, even for a multi-arch image
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# every runtime dependency is bundled into dist/index.cjs, so the final image needs no node_modules
RUN KUBEDECK_BUNDLE_ALL=1 npm run build

FROM node:22-alpine AS runtime
ARG KUBECTL_VERSION=v1.31.4
RUN apk add --no-cache curl jq \
 && arch="$(uname -m | sed 's/x86_64/amd64/; s/aarch64/arm64/')" \
 && curl -fsSLo /usr/local/bin/kubectl "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${arch}/kubectl" \
 && chmod +x /usr/local/bin/kubectl \
 && apk del curl
WORKDIR /app
# kubectl's discovery cache lives in /tmp: the pod runs with a read-only root filesystem
ENV NODE_ENV=production \
    KUBEDECK_MODE=web \
    PORT=5000 \
    KUBECACHEDIR=/tmp/kube-cache
COPY --from=build /app/dist ./dist
# numeric uid (the image's `node` user): Kubernetes can only verify runAsNonRoot for a number
USER 1000:1000
EXPOSE 5000
CMD ["node", "dist/index.cjs"]
