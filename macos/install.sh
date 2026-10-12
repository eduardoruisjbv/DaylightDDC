#!/bin/bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This installer requires macOS." >&2
  exit 1
fi
if [[ "$(uname -m)" != "x86_64" ]]; then
  echo "This first macOS build targets Intel Macs (x86_64)." >&2
  exit 1
fi
if ! command -v ddcctl >/dev/null 2>&1; then
  echo "Install ddcctl first: brew install ddcctl" >&2
  exit 1
fi
DDCCTL_BIN="$(command -v ddcctl)"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON3="$(command -v python3)"
APP="$HOME/Library/Application Support/DaylightDDC"
AGENTS="$HOME/Library/LaunchAgents"
BIN="$HOME/.local/bin"
mkdir -p "$APP" "$AGENTS" "$BIN" "$HOME/Library/Logs"
install -m 755 "$ROOT/macos/daylight-ddc-macos.py" "$APP/daylight-ddc.py"
if [[ -e "$BIN/daylight-ddc" && "$(readlink "$BIN/daylight-ddc" 2>/dev/null || true)" != "$APP/daylight-ddc.py" ]]; then
  echo "Refusing to replace existing file: $BIN/daylight-ddc" >&2
  exit 1
fi
if [[ ! -e "$APP/config.json" ]]; then
  "$APP/daylight-ddc.py" status >/dev/null
fi
ln -sf "$APP/daylight-ddc.py" "$BIN/daylight-ddc"
cat > "$AGENTS/io.github.daylightddc.Service.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>io.github.daylightddc.Service</string>
  <key>ProgramArguments</key><array><string>$PYTHON3</string><string>$APP/daylight-ddc.py</string><string>serve</string></array>
  <key>EnvironmentVariables</key><dict><key>DDCCTL</key><string>$DDCCTL_BIN</string></dict>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/DaylightDDC.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/DaylightDDC.log</string>
</dict></plist>
EOF
launchctl bootout "gui/$(id -u)" "$AGENTS/io.github.daylightddc.Service.plist" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$AGENTS/io.github.daylightddc.Service.plist"
echo "Installed DaylightDDC for Intel macOS. Add $BIN to PATH if needed."
echo "Automatic brightness remains disabled until you configure a monitor and enable it."
echo "Run: daylight-ddc monitor add 1 'Monitor name' --min 8 --max 60"
