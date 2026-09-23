#!/bin/bash
# Publish the scenario library (library/dist, from scripts/build-library.ts)
# to a Google Cloud Storage bucket, public to read and to nothing else.
#
#   ./scripts/publish-library.sh <bucket> [site-origin]
#   ./scripts/publish-library.sh exile-js-library https://thomasaustenbrown.github.io
#
# Then build the game with the catalog's URL:
#   VITE_LIBRARY_URL=https://storage.googleapis.com/<bucket>/catalog.json npm run build
#
# **The bucket is never writable by the public.** Reading is granted to
# allUsers (roles/storage.objectViewer, objects only — not listing the bucket's
# IAM or anything else); writing stays with whoever runs this, through their
# own gcloud login. Player uploads, when they come (after Part 2), must go
# through signed, size-limited, checked uploads — never a public write grant.
#
# Needs `gcloud` logged in (`gcloud auth login`) with a project set.
set -euo pipefail

BUCKET="${1:?usage: $0 <bucket> [site-origin]}"
ORIGIN="${2:-*}"
DIST="$(cd "$(dirname "$0")/.." && pwd)/library/dist"
[ -f "$DIST/catalog.json" ] || { echo "No $DIST/catalog.json — run: npx vite-node scripts/build-library.ts" >&2; exit 1; }

if ! gcloud storage buckets describe "gs://$BUCKET" >/dev/null 2>&1; then
  echo "Creating gs://$BUCKET ..."
  # Uniform bucket-level access: no per-object ACLs to get wrong.
  gcloud storage buckets create "gs://$BUCKET" --uniform-bucket-level-access
fi

echo "Granting public read on objects ..."
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member=allUsers --role=roles/storage.objectViewer >/dev/null

echo "Setting CORS (GET from $ORIGIN) ..."
CORS="$(mktemp)"
cat > "$CORS" <<JSON
[{"origin": ["$ORIGIN"], "method": ["GET", "HEAD"], "responseHeader": ["Content-Type"], "maxAgeSeconds": 3600}]
JSON
gcloud storage buckets update "gs://$BUCKET" --cors-file="$CORS"
rm -f "$CORS"

echo "Uploading ..."
# Scenario files and previews don't change once published; the catalog does.
gcloud storage rsync --recursive --delete-unmatched-destination-objects \
  --cache-control="public, max-age=86400" "$DIST" "gs://$BUCKET"
gcloud storage objects update "gs://$BUCKET/catalog.json" --cache-control="public, max-age=300"

echo "Published: https://storage.googleapis.com/$BUCKET/catalog.json"
