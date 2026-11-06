#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
report="$root/tmp/ios-simulator-build"
mkdir -p "$report"
xcrun simctl list devices available -j > "$report/devices.json"
device=$(node --input-type=module - "$report/devices.json" <<'NODE'
import fs from 'node:fs';
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const runtime = process.env.IOS_TEST_RUNTIME;
if (!runtime) throw Error('必须指定固定的 iOS 模拟器运行时');
const devices = (data.devices[runtime] || []).filter(device => device.isAvailable && device.name.includes('iPad'));
const device = devices.find(device => device.state === 'Booted') || devices[0];
if (!device) throw Error('缺少指定运行时的 iPad 模拟器：' + runtime);
console.log(device.udid);
NODE
)
xcrun simctl boot "$device" 2>/dev/null || true
xcrun simctl bootstatus "$device" -b
xcrun simctl list runtimes -j > "$report/runtimes.json"
project="$root/src-tauri/gen/apple/tauronic.xcodeproj/project.pbxproj"
cp "$project" "$report/project.pbxproj.original"
trap 'cp "$report/project.pbxproj.original" "$project"' EXIT
# 只调整本 CI checkout 的模拟器构建 SDK；正式真机 IPA 在另一任务独立编译。
node --input-type=module - "$project" <<'NODE'
import fs from 'node:fs';
const file = process.argv[2];
const source = fs.readFileSync(file, 'utf8');
if (!source.includes('SDKROOT = iphoneos;')) throw Error('未找到真机 SDK 配置，拒绝盲目修改工程');
fs.writeFileSync(file, source.replaceAll('SDKROOT = iphoneos;', 'SDKROOT = iphonesimulator;'));
NODE
xcodebuild -showBuildSettings -sdk iphonesimulator -workspace "$root/src-tauri/gen/apple/tauronic.xcodeproj/project.xcworkspace" -scheme tauronic_iOS > "$report/build-settings.txt"
xcodebuild -showdestinations -workspace "$root/src-tauri/gen/apple/tauronic.xcodeproj/project.xcworkspace" -scheme tauronic_iOS > "$report/destinations.txt"
if ! grep -Fq "$device" "$report/destinations.txt"; then
  cat "$report/destinations.txt"
  echo 'Xcode 未列出固定 iPad 模拟器目的端' >&2
  exit 1
fi
if [[ "${1:-}" == --prepare-only ]]; then exit 0; fi
if [[ "$(uname -m)" == arm64 ]]; then target=aarch64-sim; else target=x86_64; fi
pnpm exec tauri ios build --ci --no-sign --target "$target"
