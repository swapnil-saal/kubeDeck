#!/bin/sh
# Build the web-mode image and keep only the newest one: every older kubedeck image
# (and any dangling layers left behind) is removed afterwards.
#   script/docker-build.sh            builds kubedeck:<version>-web (one tag, one row in Docker Desktop)
#   script/docker-build.sh --push     builds linux/amd64 + linux/arm64 and pushes them as one tag
#                                     (most clusters run amd64 nodes; a Mac builds arm64 by default)
set -eu
cd "$(dirname "$0")/.."

version=$(node -p "require('./package.json').version")
image=swapnilsaal/kubedeck

if [ "${1:-}" = "--push" ]; then
  docker buildx build --platform linux/amd64,linux/arm64 -t "$image:$version-web" --push .
  docker buildx imagetools inspect "$image:$version-web" | grep -E "Name:|Platform:"
  exit 0
fi

docker build -t "$image:$version-web" .
new_id=$(docker image inspect --format '{{.Id}}' "$image:$version-web")

# remove every other kubedeck image (different id), then untagged leftovers
for ref in $(docker images "$image" --format '{{.Repository}}:{{.Tag}}'); do
  id=$(docker image inspect --format '{{.Id}}' "$ref")
  [ "$id" = "$new_id" ] || docker rmi "$ref" >/dev/null
done
docker image prune -f >/dev/null

echo "kept:"
docker images "$image" --format '  {{.Repository}}:{{.Tag}}  {{.Size}}'
