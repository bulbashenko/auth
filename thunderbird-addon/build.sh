#!/usr/bin/env bash
# Packs the add-on into dist/bulbashenko-mail-signin-<version>.xpi.
# Install it in Thunderbird: Add-ons and Themes > gear icon > Install Add-on From File.
set -euo pipefail
cd "$(dirname "$0")"
version=$(jq -r .version manifest.json)
mkdir -p dist
rm -f dist/*.xpi
python3 - "dist/bulbashenko-mail-signin-$version.xpi" <<'PY'
import os, sys, zipfile
files = ["manifest.json", "options.html", "options.css", "options.js"]
for root in ("api", "_locales"):
    for dirpath, _, names in os.walk(root):
        files += [os.path.join(dirpath, n) for n in sorted(names)]
with zipfile.ZipFile(sys.argv[1], "w", zipfile.ZIP_DEFLATED) as z:
    for f in files:
        z.write(f)
PY
echo "dist/bulbashenko-mail-signin-$version.xpi"
