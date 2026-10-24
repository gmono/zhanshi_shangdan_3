//! Windows 原始图片目录扫描与流式 Zoomify 缓存。原图始终只读。
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, fs, io::Read, path::{Path, PathBuf}, process::Command};

#[derive(Debug)]
pub struct Source { pub path: PathBuf, pub label: String }
#[derive(Debug)]
pub struct Sources { pub places: Vec<(String, Vec<Source>)>, pub maps: Vec<Source> }

pub fn scan(root: &Path) -> Result<Sources, String> {
    let compare=if root.join("序厅-遥感图").is_dir(){root.join("序厅-遥感图")}else{root.to_path_buf()};
    let names=[
        ("成眉S5线",["s5线2023年.png","s5线2026年.png"]),
        ("视高镇",["视高2023.png","视高镇2026.png"]),
        ("兴隆湖",["兴隆湖2023.png","兴隆湖2026.png"]),
    ];
    let mut places=Vec::new();
    for (place,files) in names {
        let mut sources=Vec::new();
        for (index,file) in files.iter().enumerate(){
            let path=compare.join(place).join(file);
            if !path.is_file(){return Err(format!("缺少原始图片：{}",path.display()));}
            sources.push(Source{path,label:if index==0{"2023".into()}else{"2026".into()}});
        }
        places.push((place.to_string(),sources));
    }
    let source=root.join("456.jpg");
    if !source.is_file(){return Err(format!("缺少原始大图：{}",source.display()));}
    let maps=(1..=5).map(|index|Source{path:source.clone(),label:format!("图{index}")}).collect();
    Ok(Sources{places,maps})
}
fn hash(path: &Path) -> Result<String,String> {
    let mut file=fs::File::open(path).map_err(|e|e.to_string())?;
    let mut hash=Sha256::new();let mut buffer=[0u8;1024*64];
    loop { let n=file.read(&mut buffer).map_err(|e|e.to_string())?;if n==0 {break;} hash.update(&buffer[..n]); }
    Ok(format!("{:x}",hash.finalize()))
}
fn size(xml: &str, key: &str) -> Result<u32,String> {
    xml.split(&format!("{key}=\"")).nth(1).and_then(|s|s.split('"').next()).and_then(|s|s.parse().ok()).filter(|n|*n>0).ok_or_else(||format!("无效 Zoomify 尺寸：{key}"))
}
pub fn prepare(root: &Path, cache: &Path, vips: &Path) -> Result<Value,String> {
    let sources=scan(root)?; fs::create_dir_all(cache).map_err(|e|e.to_string())?;
    let mut converted=BTreeMap::new();
    let mut convert=|source:&Source| -> Result<Value,String> {
        let digest=hash(&source.path)?;
        if let Some(value)=converted.get(&digest) {return Ok(Value::clone(value));}
        let index=cache.join(format!("{digest}.json"));
        let cached=fs::read(&index).ok().and_then(|b|serde_json::from_slice::<Value>(&b).ok());
        if let Some(cached)=cached {
            let folder=cached.get("folder").and_then(Value::as_str).unwrap_or("");
            if !folder.is_empty() && !folder.contains(['/', '\\', '.']) && cache.join(folder).join("ImageProperties.xml").is_file() && cache.join(folder).join("TileGroup0/0-0-0.jpg").is_file() {
                let value=cached["image"].clone(); converted.insert(digest,value.clone()); return Ok(value);
            }
        }
        let folder=format!("{}-{}",digest,std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos());
        let destination=cache.join(&folder);
        // libvips 按需流式解码和切片，不在 Rust/WebView 中整图展开数十亿像素。
        let mut command=Command::new(vips);
        command.args(["dzsave"]).arg(&source.path).arg(&destination)
            .args(["--layout","zoomify","--tile-size","256","--overlap","0","--depth","onetile","--suffix",".jpg[Q=85,strip]","--skip-blanks","-1"])
            .env("VIPS_CONCURRENCY","2").env("VIPS_DISC_THRESHOLD","64m").env("TMPDIR",cache).env("TMP",cache).env("TEMP",cache);
        #[cfg(target_os="windows")] {use std::os::windows::process::CommandExt;command.creation_flags(0x08000000);}
        let output=command.output().map_err(|e|format!("无法启动内置图片处理器：{e}"))?;
        if !output.status.success() { return Err(format!("图片处理失败 {}：{}",source.path.display(),String::from_utf8_lossy(&output.stderr))); }
        let xml=fs::read_to_string(destination.join("ImageProperties.xml")).map_err(|e|e.to_string())?;
        let value=json!({"url":format!("/zoomify/{folder}/"),"width":size(&xml,"WIDTH")?,"height":size(&xml,"HEIGHT")?});
        fs::write(&index,serde_json::to_vec(&json!({"folder":folder,"image":value})).unwrap()).map_err(|e|e.to_string())?;
        converted.insert(digest,value.clone());Ok(value)
    };
    let mut locations=vec![];
    for (i,(label,images)) in sources.places.iter().enumerate() {
        let mut ready=vec![];
        for image in images { let mut value=convert(image)?;value["year"]=json!(image.label);ready.push(value); }
        let first=&ready[0];
        if ready.iter().any(|v|v["width"]!=first["width"]||v["height"]!=first["height"]) {return Err(format!("{label} 的年份图片尺寸不同，请先提供相同画幅且配准的图片"));}
        locations.push(json!({"id":format!("place-{}",i+1),"label":label,"images":ready}));
    }
    let mut maps=vec![];
    for (i,image) in sources.maps.iter().enumerate() {let mut value=convert(image)?;value["id"]=json!(format!("map-{}",i+1));value["label"]=json!(image.label);maps.push(value);}
    Ok(json!({"locations":locations,"maps":maps}))
}

