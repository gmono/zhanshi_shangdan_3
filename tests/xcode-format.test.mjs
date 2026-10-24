import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('应用和 UI 测试工程固定 Xcode 14 格式，objectVersion 为 56',()=>{
  for(const file of ['src-tauri/gen/apple/project.yml','tests/ios/project.yml']){
    const text=readFileSync(file,'utf8');
    assert.match(text,/projectFormat: xcode14_0/);
    assert.match(text,/xcodeVersion: '14\.0'/);
  }
  const project=readFileSync('src-tauri/gen/apple/tauronic.xcodeproj/project.pbxproj','utf8');
  assert.match(project,/objectVersion = 56;/);
  assert.match(project,/compatibilityVersion = "Xcode 14\.0";/);
});
