import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('iOS 使用 SDK 标准架构，真机排除 x86_64，模拟器支持 Intel 和 Apple Silicon', () => {
  const project = readFileSync(new URL('../src-tauri/gen/apple/tauronic.xcodeproj/project.pbxproj', import.meta.url), 'utf8');
  const template = readFileSync(new URL('../src-tauri/gen/apple/project.yml', import.meta.url), 'utf8');
  assert.equal([...project.matchAll(/\bARCHS = "\$\(ARCHS_STANDARD\)";/g)].length, 2);
  assert.equal([...project.matchAll(/"EXCLUDED_ARCHS\[sdk=iphoneos\*\]" = x86_64;/g)].length, 2);
  assert.doesNotMatch(project, /\bVALID_ARCHS\b/);
  assert.match(template, /ARCHS: \$\(ARCHS_STANDARD\)/);
  assert.match(template, /EXCLUDED_ARCHS\[sdk=iphoneos\*\]: x86_64/);
  assert.doesNotMatch(template, /\bVALID_ARCHS\b/);
});
