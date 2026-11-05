import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('iOS 真机保持 arm64，模拟器按宿主支持 Intel 和 Apple Silicon', () => {
  const project = readFileSync(new URL('../src-tauri/gen/apple/tauronic.xcodeproj/project.pbxproj', import.meta.url), 'utf8');
  const template = readFileSync(new URL('../src-tauri/gen/apple/project.yml', import.meta.url), 'utf8');
  assert.equal([...project.matchAll(/ARCHS = \(\s*arm64,\s*\);/g)].length, 2);
  assert.equal([...project.matchAll(/"ARCHS\[sdk=iphonesimulator\*\]" = "\$\(ARCHS_STANDARD\)";/g)].length, 2);
  assert.equal([...project.matchAll(/"VALID_ARCHS\[sdk=iphonesimulator\*\]" = "arm64 x86_64";/g)].length, 2);
  assert.match(template, /ARCHS: \[arm64\]/);
  assert.match(template, /ARCHS\[sdk=iphonesimulator\*\]: \$\(ARCHS_STANDARD\)/);
  assert.match(template, /VALID_ARCHS\[sdk=iphonesimulator\*\]: arm64 x86_64/);
});
