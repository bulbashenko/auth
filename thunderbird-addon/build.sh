#!/usr/bin/env bash
# Packs the add-on into dist/bulbashenko-mail-signin-<version>.xpi.
# Install it in Thunderbird: Add-ons and Themes > gear icon > Install Add-on From File.
set -euo pipefail
cd "$(dirname "$0")"
version=$(jq -r .version manifest.json)
mkdir -p dist
rm -f dist/*.xpi
python3 -c "import sys, zipfile; zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED).write('manifest.json')" "dist/bulbashenko-mail-signin-$version.xpi"
echo "dist/bulbashenko-mail-signin-$version.xpi"
