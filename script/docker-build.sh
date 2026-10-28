#!/bin/sh
# Build the web-mode image and keep only the newest one: every older kubedeck image
# (and any dangling layers left behind) is removed afterwards.
#   script/docker-build.sh            builds kubedeck:<version>-web and kubedeck:web-latest
set -eu
cd "$(dirname "$0")/.."

version=$(node -p "require('./package.json').version")
image=kubedeck

docker build -t "$image:$version-web" -t "$image:web-latest" .
new_id=$(docker image inspect --format '{{.Id}}' "$image:web-latest")

# remove every other kubedeck image (different id), then untagged leftovers
for ref in $(docker images "$image" --format '{{.Repository}}:{{.Tag}}'); do
  id=$(docker image inspect --format '{{.Id}}' "$ref")
  [ "$id" = "$new_id" ] || docker rmi "$ref" >/dev/null
done
docker image prune -f >/dev/null

echo "kept:"
docker images "$image" --format '  {{.Repository}}:{{.Tag}}  {{.Size}}'
