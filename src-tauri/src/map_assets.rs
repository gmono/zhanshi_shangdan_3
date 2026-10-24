//! Windows 原始图片目录扫描与流式 Zoomify 缓存。原图始终只读。
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, fs, io::Read, path::{Path, PathBuf}, process::Command};

#[derive(Debug)]
pub struct Source { pub path: PathBuf, pub label: String }
#[derive(Debug)]
pub struct Sources { pub places: Vec<(String, Vec<Source>)>, pub maps: Vec<Source> }

fn images(root: &Path) -> Result<Vec<PathBuf>, String> {
    if !root.is_dir() { return Ok(vec![]); }
    let mut files = vec![];
    for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.is_file() && matches!(path.extension().and_then(|v|v.to_str()).unwrap_or("").to_ascii_lowercase().as_str(), "jpg"|"jpeg"|"png"|"tif"|"tiff") { files.push(path); }
    }
    files.sort(); Ok(files)
}
pub fn scan(root: &Path) -> Result<Sources, String> {
    let mut places = BTreeMap::new();
    let compare = root.join("对比");
    if compare.is_dir() {
        for entry in fs::read_dir(compare).map_err(|e|e.to_string())? {
            let path = entry.map_err(|e|e.to_string())?.path();
            if !path.is_dir() { continue; }
            let label = path.file_name().unwrap().to_string_lossy().into_owned();
            let mut years = BTreeMap::new();
            for file in images(&path)? {
                let year = file.file_stem().unwrap().to_string_lossy().into_owned();
                if year.len()!=4 || !year.bytes().all(|c|c.is_ascii_digit()) { return Err(format!("{label} 的图片请按四位年份命名：{}",file.display())); }
                if years.insert(year.clone(),Source{path:file,label:year.clone()}).is_some() { return Err(format!("{label} 的 {year} 年存在重复图片")); }
            }
            if years.len()>11 {return Err(format!("{label} 最多支持11个年份"));}
            if !years.is_empty() { places.insert(label,years.into_values().collect()); }
        }
    }
    if places.len()!=3 { return Err("请在 地图资源/对比 下放置三个地点文件夹，每个地点包含按年份命名的图片".into()); }
    let mut maps = BTreeMap::new();
    for path in images(&root.join("大图"))? {
        let label = path.file_stem().unwrap().to_string_lossy().into_owned();
        if !["图1","图2","图3","图4","图5"].contains(&label.as_str()) { return Err(format!("大图请命名为图1至图5：{}",path.display())); }
        if maps.insert(label.clone(),Source{path,label:label.clone()}).is_some() { return Err(format!("{label} 存在重复图片")); }
    }
    if maps.len()!=5 { return Err("请在 地图资源/大图 下放置图1至图5，共五张图片".into()); }
    Ok(Sources{places:places.into_iter().collect(),maps:maps.into_values().collect()})
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

#[cfg(test)] mod tests {
    use super::*;
    fn fixture() -> PathBuf {
        let root=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tmp").join(format!("assets-test-{}",std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        for place in ["成眉S5线","视高镇","兴隆湖"] { let d=root.join("对比").join(place);fs::create_dir_all(&d).unwrap();for year in ["2026","2023"] {fs::write(d.join(format!("{year}.png")),b"fixture").unwrap();}}
        fs::create_dir_all(root.join("大图")).unwrap();for i in 1..=5 {fs::write(root.join(format!("大图/图{i}.jpg")),b"fixture").unwrap();}root
    }
    #[test] fn raw_names_and_year_order() {let s=scan(&fixture()).unwrap();assert_eq!(s.places.len(),3);assert_eq!(s.places[0].1[0].label,"2023");assert_eq!(s.maps.len(),5);}
    #[test] fn reject_duplicate_year_and_missing_data() {let r=fixture();fs::write(r.join("对比/视高镇/2023.tif"),b"fixture").unwrap();assert!(scan(&r).unwrap_err().contains("重复"));assert!(scan(Path::new("missing-directory")).is_err());}
}
