import {readFileSync} from 'node:fs';
const files=process.argv.slice(2);
for(const file of files.length?files:['src-tauri/gen/apple/tauronic.xcodeproj/project.pbxproj']){
  const source=readFileSync(file,'utf8');
  if(!/objectVersion\s*=\s*56\s*;/.test(source)||!/compatibilityVersion\s*=\s*"Xcode 14\.0"\s*;/.test(source))throw Error(`Xcode 工程格式必须是 objectVersion=56、Xcode 14.0：${file}`);
  console.log(`Xcode 工程格式校验通过：objectVersion=56，${file}`);
}
