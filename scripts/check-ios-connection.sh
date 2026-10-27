#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
report="$root/tmp/ios-connection"
mkdir -p "$report"
export E2E_REPORT_DIR="$report" E2E_NO_FRONTEND=1
export VIPS_BIN="$(command -v vips)"
export E2E_NATIVE_BINARY="$root/tmp/native-test-target/debug/exhibition-resource-test-server"
node scripts/e2e-server.mjs > "$report/server.log" 2>&1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT
for i in $(seq 1 90); do
  if curl -fsS http://127.0.0.1:1421/catalog > "$report/catalog.json"; then break; fi
  sleep 1
done
curl -fsS http://127.0.0.1:1421/catalog > "$report/catalog.json"
xcrun simctl list devices available -j > "$report/devices.json"
device=$(node --input-type=module -e 'import fs from "node:fs";const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const list=Object.entries(d.devices).filter(([k])=>k.includes("iOS")).flatMap(([,v])=>v).filter(v=>v.isAvailable&&v.name.includes("iPad"));if(!list.length)throw Error("缺少 iPad 模拟器");console.log((list.find(v=>v.state==="Booted")||list[0]).udid)' "$report/devices.json")
xcrun simctl boot "$device" 2>/dev/null || true
xcrun simctl bootstatus "$device" -b
app="${IOS_LAUNCH_APP:-$(find "$root/src-tauri/gen/apple/build" -type d -name Exhibition.app -print -quit)}"
test -d "$app"
codesign --force --sign - "$app"
xcrun simctl install "$device" "$app"
cp tests/ios/*.swift tests/ios/project.yml "$report/"
xcodegen generate --spec "$report/project.yml" --project "$report"
node scripts/check-xcode-format.mjs "$report/ExhibitionConnection.xcodeproj/project.pbxproj"
xcodebuild test -project "$report/ExhibitionConnection.xcodeproj" -scheme ExhibitionConnection -destination "platform=iOS Simulator,id=$device" -derivedDataPath "$report/DerivedData" -resultBundlePath "$report/Connection.xcresult" CODE_SIGN_IDENTITY=- | tee "$report/xctest.log"
node --input-type=module - "$report" <<'EOF'
import{readFileSync,writeFileSync}from'node:fs';
import assert from'node:assert/strict';
const root=process.argv[2];const rows=readFileSync(root+'/http-requests.ndjson','utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const tiles=rows.filter(r=>r.status===200&&r.bytes>0&&/\/zoomify\/.*\.jpg/.test(r.url)&&/AppleWebKit/.test(r.userAgent||''));
const catalog=JSON.parse(readFileSync(root+'/catalog.json','utf8'));
const maps=[...new Set(tiles.map(r=>r.url.match(/\/zoomify\/(map-\d+)\//)?.[1]).filter(Boolean))];
assert(catalog.maps.length>=1&&catalog.maps.length<=10,'目录地图数量不在1到10范围');
assert.deepEqual(catalog.maps.map(map=>map.id),Array.from({length:catalog.maps.length},(_,i)=>`map-${i+1}`),'目录地图编号不连续');
assert.deepEqual(maps.sort((a,b)=>Number(a.slice(4))-Number(b.slice(4))),catalog.maps.map(map=>map.id),'真正的 iOS WebView 未读取目录中的全部地图');
for(const map of maps)assert(tiles.some(r=>r.url.includes(`/zoomify/${map}/`)),`真正的 iOS WebView 没有读取${map}瓦片`);
for(let i=1;i<=3;i++)for(const number of [1,2])assert(tiles.some(r=>r.url.includes(`/zoomify/place-${i}-${number}/`)),`真正的 iOS WebView 没有读取地点${i}-${number}瓦片`);
writeFileSync(root+'/result.json',JSON.stringify({passed:true,iosTileRequests:tiles.length,checkedMaps:maps.length,checkedComparisons:6},null,2));
EOF
