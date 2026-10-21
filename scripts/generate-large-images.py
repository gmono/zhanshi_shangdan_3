"""生成三张同配准 144MP 展厅测试图及标准 Zoomify 金字塔。"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import math, random, json

ROOT = Path(__file__).resolve().parent.parent
W, H, TILE = 16000, 9000, 256
Image.MAX_IMAGE_PIXELS = 200_000_000
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'

def font(size):
    return ImageFont.truetype(FONT, size)

def generate(index):
    rng = random.Random(20261019)
    palettes = [('#eef0e6','#809a7b','#1d473e','#cfb879'),('#e8eef2','#829daf','#233f59','#dfad73'),('#f2e8e2','#ba927a','#573e38','#96a98b')]
    bg, building, ink, accent = palettes[index]
    im = Image.new('RGB', (W,H), bg)
    d = ImageDraw.Draw(im)
    for x in range(0,W,100): d.line((x,0,x,H), fill='#d4d9d0',width=1)
    for y in range(0,H,100): d.line((0,y,W,y), fill='#d4d9d0',width=1)
    d.rounded_rectangle((250,250,W-250,H-250),radius=160,outline=ink,width=18)
    d.text((550,480), f'EXHIBITION ATLAS / SCHEME {index+1:02d}',font=font(180),fill=ink)
    d.text((560,750),'144 MEGAPIXELS / 16000 x 9000 / REGISTERED FLOOR PLAN',font=font(55),fill=ink)
    # 固定建筑边界，三组图只修改方案布局与配色。
    for row in range(4):
        for col in range(8):
            x,y=650+col*1850,1450+row*1640
            d.rounded_rectangle((x,y,x+1600,y+1330),radius=75,fill=building,outline=ink,width=9)
            d.rounded_rectangle((x+50,y+60,x+1550,y+1270),radius=45,fill=bg,outline=ink,width=4)
            d.text((x+95,y+95),f'HALL {row*8+col+1:02d}',font=font(90),fill=ink)
            for j in range(5):
                for k in range(4):
                    bx,by=x+90+j*280,y+310+k*210
                    d.rounded_rectangle((bx,by,bx+210,by+150),radius=15,fill=accent if (j+k+index)%3==0 else building,outline=ink,width=3)
                    d.text((bx+12,by+15),f'{row+1}{col+1}-{j+1}{k+1}',font=font(26),fill=ink)
                    # 原生分辨率下可辨认的座位、网格与标尺细节。
                    for seat in range(6):
                        sx=bx+17+seat*30
                        d.rectangle((sx,by+92,sx+13,by+111),fill=ink)
            d.text((x+90,y+1190),f'ZONE {col+1} / LEVEL {row+1} / OPTION {index+1}',font=font(30),fill=ink)
    # 同配准轴线及走道；细节随方案变化。
    for row in range(5):
        y=1370+row*1640
        d.line((500,y,15500,y),fill=ink,width=8)
        for x in range(550,15500,100):
            d.line((x,y-15,x,y+15),fill=ink,width=2)
    for col in range(9):
        x=560+col*1850
        d.line((x,1250,x,8120),fill=ink,width=5)
        for y in range(1500,8000,130):
            if rng.random()>.4: d.ellipse((x-15,y-15,x+15,y+15),fill=accent)
    d.text((600,8420),'NORTH  ^     SCALE 1:100     DEMONSTRATION DATA - NOT A REAL FLOOR PLAN',font=font(65),fill=ink)
    src=ROOT/'assets/source-images'/f'exhibition-{index+1}.tif'
    im.save(src,compression='raw')
    preview=im.copy();preview.thumbnail((1600,900));preview.save(ROOT/'assets/source-images'/f'exhibition-{index+1}-preview.jpg',quality=90)
    out=ROOT/'public/zoomify'/f'scheme-{index+1}';out.mkdir(parents=True,exist_ok=True)
    max_z=math.ceil(math.log2(max(W,H)/TILE))
    total=0
    for z in range(max_z+1):
        scale=2**(max_z-z)
        size=(math.ceil(W/scale),math.ceil(H/scale))
        tier=im if scale==1 else im.resize(size,Image.Resampling.LANCZOS)
        nx,ny=math.ceil(size[0]/TILE),math.ceil(size[1]/TILE)
        for y in range(ny):
            for x in range(nx):
                group=out/f'TileGroup{total//256}';group.mkdir(exist_ok=True)
                tier.crop((x*TILE,y*TILE,min((x+1)*TILE,size[0]),min((y+1)*TILE,size[1]))).save(group/f'{z}-{x}-{y}.jpg',quality=88)
                total+=1
        print(f'方案{index+1} 层级{z}: {size}, 累计{total}瓦片',flush=True)
    (out/'ImageProperties.xml').write_text(f'<IMAGE_PROPERTIES WIDTH="{W}" HEIGHT="{H}" NUMTILES="{total}" NUMIMAGES="1" VERSION="1.8" TILESIZE="256" />')
    return {'name':f'方案{index+1}','width':W,'height':H,'sourceBytes':src.stat().st_size,'tiles':total,'levels':max_z+1,'url':f'/zoomify/scheme-{index+1}/'}

if __name__=='__main__':
    manifest=[generate(i) for i in range(3)]
    (ROOT/'public/zoomify/manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
    print(json.dumps(manifest,ensure_ascii=False,indent=2),flush=True)
