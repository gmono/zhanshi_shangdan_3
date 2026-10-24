// 仅为自动化测试生成原始图片；绝不读取、缩放或覆盖客户图片。
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^(crc&1?0xedb88320:0);}return(crc^0xffffffff)>>>0;}
function chunk(type,bytes){const name=Buffer.from(type);const result=Buffer.alloc(bytes.length+12);result.writeUInt32BE(bytes.length);name.copy(result,4);bytes.copy(result,8);result.writeUInt32BE(crc32(Buffer.concat([name,bytes])),bytes.length+8);return result;}
function png(width,height,seed){
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
  const pixels=Buffer.alloc((width*3+1)*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*(width*3+1)+1+x*3;pixels[i]=(x+seed*47)%220+20;pixels[i+1]=(y+seed*71)%210+25;pixels[i+2]=((x>>4)^(y>>4)^seed)*23%200+30;}
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
export async function createOriginals(root,vips=process.env.VIPS_BIN||'vips'){
  await mkdir(root,{recursive:true});const originals=[];
  const places=[['成眉S5线','s5线2023年.png','s5线2026年.png'],['视高镇','视高2023.png','视高镇2026.png'],['兴隆湖','兴隆湖2023.png','兴隆湖2026.png']];
  for(let i=0;i<places.length;i++)for(let j=0;j<2;j++){
    const file=join(root,'序厅-遥感图',places[i][0],places[i][j+1]);await mkdir(join(file,'..'),{recursive:true});
    const width=640+j*160,height=360+j*80;await writeFile(file,png(width,height,i*2+j+1));originals.push({file,width,height});
  }
  for(let i=1;i<=5;i++){
    const file=join(root,`图${i}.jpg`),temporary=join(root,`.test-${i}.png`);await writeFile(temporary,png(1600,1000,i+10));
    execFileSync(vips,['jpegsave',temporary,file],{stdio:'pipe'});originals.push({file,width:1600,height:1000});
  }
  for(const original of originals)original.sha256=createHash('sha256').update(await readFile(original.file)).digest('hex');
  await writeFile(join(root,'test-originals.json'),JSON.stringify(originals,null,2));return originals;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){await createOriginals(resolve(process.argv[2]||'tmp/e2e/originals'));}
