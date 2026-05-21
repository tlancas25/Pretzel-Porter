#!/usr/bin/env bash
#
# Pretzel Porter — installer
#
#   ./install.sh            install (or reinstall) from this checkout
#   ./install.sh --update   git pull the latest, then rebuild + reinstall
#
# Builds the project and installs it system-wide: the compiled app goes to
# /opt/pretzel-porter and a launcher is placed at /usr/local/bin/pport.
# Afterwards, run `pport` (or `sudo pport`) from any terminal.
#
set -euo pipefail

APP_DIR="/opt/pretzel-porter"
BIN="/usr/local/bin/pport"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- arguments -----------------------------------------------------------
UPDATE=0
for arg in "$@"; do
  case "$arg" in
    --update) UPDATE=1 ;;
    -h|--help)
      echo "usage: ./install.sh [--update]"
      echo "  (no flag)   build + install from this checkout"
      echo "  --update    git pull the latest, then build + install"
      exit 0 ;;
    *) echo "error: unknown option '$arg' (try --help)"; exit 2 ;;
  esac
done

echo "Pretzel Porter — installer"
echo

# --- 0. update: pull the latest before building --------------------------
if [ "$UPDATE" -eq 1 ]; then
  if [ ! -d "$HERE/.git" ]; then
    echo "error: --update needs a git checkout — re-clone from"
    echo "       https://github.com/tlancas25/Pretzel-Porter.git"
    exit 1
  fi
  echo "→ fetching the latest version..."
  ( cd "$HERE" && git pull --ff-only )
  echo
fi

# --- 1. prerequisites ----------------------------------------------------
command -v node >/dev/null 2>&1 || { echo "error: Node.js 20+ is required — https://nodejs.org"; exit 1; }
command -v npm  >/dev/null 2>&1 || { echo "error: npm is required"; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "error: Node.js 20+ required (found $(node -v))"
  exit 1
fi

# --- 2. build (as the current user) --------------------------------------
echo "→ installing build dependencies..."
( cd "$HERE" && npm install --silent )
echo "→ compiling TypeScript..."
( cd "$HERE" && npm run build --silent )
[ -f "$HERE/dist/index.js" ] || { echo "error: build produced no dist/index.js"; exit 1; }

# --- 3. install system-wide (needs root) ---------------------------------
echo "→ installing to $APP_DIR  (sudo)..."
sudo rm -rf "$APP_DIR"
sudo mkdir -p "$APP_DIR"
sudo cp -r "$HERE/dist" "$APP_DIR/dist"
sudo cp "$HERE/agent.config.json" "$APP_DIR/agent.config.json"

# --- 4. launcher ---------------------------------------------------------
echo "→ installing launcher at $BIN..."
sudo tee "$BIN" >/dev/null <<'EOF'
#!/usr/bin/env bash
# Pretzel Porter launcher — runs the agent in the current directory.
exec node /opt/pretzel-porter/dist/index.js "$@"
EOF
sudo chmod +x "$BIN"

echo
echo "✓ Pretzel Porter installed."
echo
echo "  pport         run it in the current directory"
echo "  sudo pport    run as root (to reach root-owned files)"
echo
echo "Optional per-user config: ~/.pretzel-porter/agent.config.json"
