#!/bin/zsh
set -eu

if [[ $# -lt 1 ]]; then
  echo "Usage: ./native-host/install-macos.sh <chrome-extension-id>"
  exit 1
fi

extension_id="$1"
script_dir="${0:A:h}"
host_path="$script_dir/host.js"
node_path="$(command -v node)"
installed_dir="$HOME/Library/Application Support/ExcaliSync"
installed_host="$installed_dir/host.js"
chrome_dir="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
firefox_dir="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"

mkdir -p "$installed_dir" "$chrome_dir" "$firefox_dir" "$HOME/.excalidraw-sync/.trash" "$HOME/.excalidraw-sync/.logs"
sed "1s|.*|#!$node_path|" "$host_path" > "$installed_host"
chmod 700 "$installed_host"

sed -e "s|__HOST_PATH__|$installed_host|g" -e "s|__EXTENSION_ID__|$extension_id|g" \
  "$script_dir/manifests/chrome.json.template" > "$chrome_dir/com.thiagoheron.excalidraw_sync.json"
sed -e "s|__HOST_PATH__|$installed_host|g" \
  "$script_dir/manifests/firefox.json.template" > "$firefox_dir/com.thiagoheron.excalidraw_sync.json"
chmod 600 "$chrome_dir/com.thiagoheron.excalidraw_sync.json" "$firefox_dir/com.thiagoheron.excalidraw_sync.json"

echo "ExcaliSync native storage installed at $HOME/.excalidraw-sync"
