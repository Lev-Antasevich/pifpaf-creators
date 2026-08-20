#!/bin/sh
set -e
ROOT="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
if command -v node >/dev/null 2>&1; then
  NODE="$(command -v node)"
elif [ -x "$HOME/.local/node/bin/node" ]; then
  export PATH="$HOME/.local/node/bin:$PATH"
  NODE="$HOME/.local/node/bin/node"
else
  echo "Нужен Node.js 18+. Положи его в PATH или в ~/.local/node"
  exit 1
fi
cd "$ROOT"
exec "$NODE" server/index.js
