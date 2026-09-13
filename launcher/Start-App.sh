#!/usr/bin/env bash
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT" || {
  echo "Could not open the application folder."
  exit 1
}

if [ -x "backend/.venv/bin/python" ]; then
  exec "backend/.venv/bin/python" "start_app.py"
fi

PYTHON=""
for candidate in python3 python; do
  if command -v "$candidate" >/dev/null 2>&1; then
    if "$candidate" -c 'import sys; sys.exit(sys.version_info < (3, 10))' >/dev/null 2>&1; then
      PYTHON="$candidate"
      break
    fi
  fi
done

if [ -z "$PYTHON" ]; then
  echo "Python 3.10 or newer is required."
  echo
  if [ "$(uname -s)" = "Darwin" ]; then
    echo "Install Python from https://www.python.org/downloads/macos/"
    echo "or, if you use Homebrew: brew install python"
  else
    echo "Install Python 3.10+ using your distribution's package manager."
  fi
  exit 1
fi

exec "$PYTHON" "start_app.py"
