#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
mkdir -p tmp/ios-launch-check
app="$root/src-tauri/gen/apple/build/arm64-sim/展厅App.app"
test -d "$app" || { echo '缺少模拟器应用成品' >&2; exit 1; }
xcrun simctl list devices available -j > tmp/ios-launch-check/devices.json
device=$(node --input-type=module -e 'import fs from "node:fs";const all=JSON.parse(fs.readFileSync("tmp/ios-launch-check/devices.json","utf8"));const choices=Object.entries(all.devices).filter(([key])=>key.includes("iOS")).flatMap(([,list])=>list).filter(d=>d.isAvailable&&d.name.includes("iPad"));if(!choices.length)throw Error("没有可用iPad模拟器");console.log((choices.find(d=>d.state==="Booted")||choices[0]).udid)')
collect() {
  xcrun simctl io "$device" screenshot tmp/ios-launch-check/screen.png || true
  xcrun simctl spawn "$device" log show --last 5m --style compact --predicate 'process == "展厅App" OR process == "ReportCrash" OR process == "SpringBoard"' > tmp/ios-launch-check/system.log 2>&1 || true
  if [[ -d "$HOME/Library/Logs/DiagnosticReports" ]]; then
    cp -R "$HOME/Library/Logs/DiagnosticReports" tmp/ios-launch-check/DiagnosticReports || true
  fi
}
trap collect EXIT
xcrun simctl boot "$device" 2>/dev/null || true
xcrun simctl bootstatus "$device" -b
bundle=$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$app/Info.plist")
codesign --force --sign - "$app"
xcrun simctl install "$device" "$app"
xcrun simctl launch "$device" "$bundle" | tee tmp/ios-launch-check/launch.txt
pid=$(awk '{print $NF}' tmp/ios-launch-check/launch.txt | tail -n 1)
[[ "$pid" =~ ^[0-9]+$ ]] || { echo '未取得启动进程号' >&2; exit 1; }
for interval in 5 15 25; do
  sleep "$interval"
  kill -0 "$pid" || { echo "iOS 启动后进程退出：$pid" >&2; exit 1; }
done
printf 'iPad 模拟器进程持续存活45秒，PID=%s，Bundle=%s\n' "$pid" "$bundle" | tee tmp/ios-launch-check/result.txt
