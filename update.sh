#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
echo "Updating HN data..."
node update.mjs
echo "Done. Open index.html in a browser."
