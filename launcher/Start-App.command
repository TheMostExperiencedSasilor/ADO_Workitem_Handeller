#!/usr/bin/env bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
"$SCRIPT_DIR/Start-App.sh"
STATUS=$?

if [ "$STATUS" -ne 0 ]; then
  echo
  read -r -p "Setup or startup failed. Press Enter to close..."
fi

exit "$STATUS"
