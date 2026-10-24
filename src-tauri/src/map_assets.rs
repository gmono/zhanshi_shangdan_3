//! Windows 原始图片目录扫描与流式 Zoomify 缓存。原图始终只读。
//! 文件名是硬约束；不使用哈希，缓存目录直接使用固定键。
use serde_json::{json, Value};
use std::{ffi::OsStr, fs, path::{Path, PathBuf}, process::{Command,Stdio}, time::{UNIX_EPOCH,Instant,Duration}};

pub fn resource_root(executable:&Path, override_root:Option<&OsStr>) -> Result<PathBuf,String> {
    if let Some(root)=override_root {return Ok(PathBuf::from(root));}
    Ok(executable.parent().ok_or("无法定位安装目录")?.join("地图资源"))
}

fn source_stamp(source:&Path) -> Result<Value,String> {
    let metadata=fs::metadata(source).map_err(|e|e.to_string())?;
    let modified=metadata.modified().map_err(|e|e.to_string())?.duration_since(UNIX_EPOCH).map_err(|e|e.to_string())?;
    Ok(json!({"version":1,"file":source.file_name().unwrap_or_default().to_string_lossy(),"bytes":metadata.len(),"modifiedNs":modified.as_nanos().to_string()}))
}

fn cache_matches(destination:&Path, stamp:&Value) -> bool {
    if !destination.join("ImageProperties.xml").is_file() || !destination.join("TileGroup0/0-0-0.jpg").is_file() {return false;}
    fs::read(destination.join("source.json")).ok().and_then(|bytes|serde_json::from_slice::<Value>(&bytes).ok()).as_ref()==Some(stamp)
}

#[derive(Debug)]
pub struct Source { pub path: PathBuf, pub label: String, pub key: String }
#[derive(Debug)]
pub struct Sources { pub places: Vec<(String, Vec<Source>)>, pub maps: Vec<Source> }

pub fn scan(root: &Path) -> Result<Sources, String> {
    let compare = if root.join("序厅-遥感图").is_dir() { root.join("序厅-遥感图") } else { root.to_path_buf() };
    let names = [
        ("成眉S5线", ["s5线2023年.png", "s5线2026年.png"]),
        ("视高镇", ["视高2023.png", "视高镇2026.png"]),
        ("兴隆湖", ["兴隆湖2023.png", "兴隆湖2026.png"]),
    ];
    let mut places = Vec::new();
    for (place_index, (place, files)) in names.iter().enumerate() {
        let mut sources = Vec::new();
        for (index, file) in files.iter().enumerate() {
            let path = compare.join(*place).join(*file);
            if !path.is_file() { return Err(format!("缺少原始图片：{}", path.display())); }
            let year = if index == 0 { "2023" } else { "2026" };
            sources.push(Source { path, label: year.into(), key: format!("place-{}-{}", place_index + 1, year) });
        }
        places.push((place.to_string(), sources));
    }
    let mut maps = Vec::new();
    for (index, name) in ["图1.jpg", "图2.jpg", "图3.jpg", "图4.jpg", "图5.jpg"].iter().enumerate() {
        let path = root.join(*name);
        if !path.is_file() { return Err(format!("缺少大图：{}", path.display())); }
        let label = format!("图{}", index + 1);
        maps.push(Source { path, label: label.clone(), key: format!("map-{}", index + 1) });
    }
    Ok(Sources { places, maps })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{ffi::OsStr, time::{SystemTime, UNIX_EPOCH}};

    fn temp() -> PathBuf {
        let root=std::env::temp_dir().join(format!("exhibition-original-{}-{}",std::process::id(),SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&root).unwrap(); root
    }

    #[test]
    fn uses_install_directory_even_when_resources_are_not_created_yet() {
        assert_eq!(resource_root(Path::new("/install/exhibition/tauronic.exe"),None).unwrap(),PathBuf::from("/install/exhibition/地图资源"));
        assert_eq!(resource_root(Path::new("/install/exhibition/tauronic.exe"),Some(OsStr::new("/test/originals"))).unwrap(),PathBuf::from("/test/originals"));
    }

    #[test]
    fn legacy_preview_cache_is_not_accepted_as_original() {
        let root=temp(); let source=root.join("原图.png");fs::write(&source,b"original").unwrap();
        let cache=root.join("cache");fs::create_dir_all(cache.join("TileGroup0")).unwrap();
        fs::write(cache.join("ImageProperties.xml"),"<IMAGE_PROPERTIES WIDTH=\"640\" HEIGHT=\"360\" />").unwrap();
        fs::write(cache.join("TileGroup0/0-0-0.jpg"),b"preview").unwrap();
        let stamp=source_stamp(&source).unwrap();
        assert!(!cache_matches(&cache,&stamp));
        fs::write(cache.join("source.json"),serde_json::to_vec(&stamp).unwrap()).unwrap();
        assert!(cache_matches(&cache,&stamp));
        assert_eq!(fs::read(&source).unwrap(),b"original");
        fs::write(&source,b"replacement original content").unwrap();
        assert!(!cache_matches(&cache,&source_stamp(&source).unwrap()));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reports_scan_before_missing_original_error() {
        let root=temp();let events=std::cell::RefCell::new(Vec::new());
        let result=prepare_with_progress(&root,&root.join(".cache"),Path::new("missing-vips"),&|value|events.borrow_mut().push(value));
        assert!(result.unwrap_err().contains("缺少原始图片"));
        assert_eq!(events.borrow()[0]["phase"],"scanning");
        assert_eq!(events.borrow()[0]["total"],11);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cached_originals_report_every_file_and_ready() {
        let root=temp();let cache=root.join(".cache");
        for (place,names) in [("成眉S5线",["s5线2023年.png","s5线2026年.png"]),("视高镇",["视高2023.png","视高镇2026.png"]),("兴隆湖",["兴隆湖2023.png","兴隆湖2026.png"])] {
            fs::create_dir_all(root.join(place)).unwrap();for name in names {fs::write(root.join(place).join(name),b"original").unwrap();}
        }
        for i in 1..=5 {fs::write(root.join(format!("图{i}.jpg")),b"original").unwrap();}
        let sources=scan(&root).unwrap();
        for source in sources.places.iter().flat_map(|(_,v)|v.iter()).chain(sources.maps.iter()) {
            let destination=cache.join(&source.key);fs::create_dir_all(destination.join("TileGroup0")).unwrap();
            fs::write(destination.join("ImageProperties.xml"),"<IMAGE_PROPERTIES WIDTH=\"800\" HEIGHT=\"600\" />").unwrap();
            fs::write(destination.join("TileGroup0/0-0-0.jpg"),b"tile").unwrap();
            fs::write(destination.join("source.json"),serde_json::to_vec(&source_stamp(&source.path).unwrap()).unwrap()).unwrap();
        }
        let events=std::cell::RefCell::new(Vec::new());
        prepare_with_progress(&root,&cache,Path::new("unused"),&|v|events.borrow_mut().push(v)).unwrap();
        let events=events.into_inner();assert_eq!(events.iter().filter(|v|v["phase"]=="cached").count(),11);
        assert_eq!(events.last().unwrap()["phase"],"ready");assert_eq!(events.last().unwrap()["completed"],11);
        fs::remove_dir_all(root).unwrap();
    }
}

fn size(xml: &str, key: &str) -> Result<u32, String> {
    xml.split(&format!("{key}=\"")).nth(1).and_then(|s| s.split('"').next()).and_then(|s| s.parse().ok()).filter(|n| *n > 0).ok_or_else(|| format!("无效 Zoomify 尺寸：{key}"))
}

pub fn prepare(root: &Path, cache: &Path, vips: &Path) -> Result<Value, String> {
    prepare_with_progress(root,cache,vips,&|_|{})
}

pub fn prepare_with_progress(root:&Path,cache:&Path,vips:&Path,report:&dyn Fn(Value)) -> Result<Value,String> {
    let started=Instant::now();
    report(json!({"phase":"scanning","completed":0,"total":11,"elapsedMs":0,"sourcePath":root,"message":"正在检查原始图片目录"}));
    let sources = scan(root)?;
    fs::create_dir_all(cache).map_err(|e| e.to_string())?;
    let mut completed=0;
    let mut convert = |source: &Source| -> Result<Value, String> {
        let notify=|phase:&str,message:&str|report(json!({"phase":phase,"completed":completed,"total":11,"currentFile":source.path.file_name().unwrap_or_default().to_string_lossy(),"sourcePath":source.path,"processorPath":vips,"elapsedMs":started.elapsed().as_millis() as u64,"message":message}));
        notify("checking","正在检查原图和缓存");
        let folder = source.key.clone();
        let destination = cache.join(&folder);
        let stamp=source_stamp(&source.path)?;
        if cache_matches(&destination,&stamp) {
            let xml = fs::read_to_string(destination.join("ImageProperties.xml")).map_err(|e| e.to_string())?;
            let value=json!({"url": format!("/zoomify/{folder}/"), "width": size(&xml, "WIDTH")?, "height": size(&xml, "HEIGHT")?});
            notify("cached","已验证并复用原图缓存");
            completed+=1;
            return Ok(value);
        }
        let pending=cache.join(format!(".{folder}-pending"));
        if pending.exists() {fs::remove_dir_all(&pending).map_err(|e|e.to_string())?;}
        // libvips 按需流式解码和切片，不在 Rust/WebView 中整图展开数十亿像素。
        let mut command = Command::new(vips);
        command.args(["dzsave"]).arg(&source.path).arg(&pending)
            .args(["--layout", "zoomify", "--tile-size", "256", "--overlap", "0", "--depth", "onetile", "--suffix", ".jpg[Q=85,strip]", "--skip-blanks", "-1"])
            .env("VIPS_CONCURRENCY", "2").env("VIPS_DISC_THRESHOLD", "64m").env("TMPDIR", cache).env("TMP", cache).env("TEMP", cache);
        #[cfg(target_os = "windows")] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
        let stderr_path=cache.join(format!(".{folder}-stderr.log"));
        let stdout_path=cache.join(format!(".{folder}-stdout.log"));
        command.stderr(Stdio::from(fs::File::create(&stderr_path).map_err(|e|e.to_string())?));
        command.stdout(Stdio::from(fs::File::create(&stdout_path).map_err(|e|e.to_string())?));
        notify("processing","正在解码原图并生成显示瓦片，原图保持不变");
        let mut child=command.spawn().map_err(|e|format!("无法启动图片处理器\n原图：{}\n处理器：{}\n系统错误：{e}",source.path.display(),vips.display()))?;
        let status=loop {
            if let Some(status)=child.try_wait().map_err(|e|format!("读取图片处理进程状态失败：{e}"))? {break status;}
            notify("processing","正在解码原图并生成显示瓦片，原图保持不变");
            std::thread::sleep(Duration::from_millis(250));
        };
        if !status.success() {
            return Err(format!("图片处理失败\n原图：{}\n处理器：{}\n退出状态：{status}\n错误输出：\n{}\n标准输出：\n{}",source.path.display(),vips.display(),fs::read_to_string(&stderr_path).unwrap_or_default(),fs::read_to_string(&stdout_path).unwrap_or_default()));
        }
        notify("validating","切片已生成，正在验证尺寸并保存缓存");
        let xml = fs::read_to_string(pending.join("ImageProperties.xml")).map_err(|e| e.to_string())?;
        let dimensions=(size(&xml,"WIDTH")?,size(&xml,"HEIGHT")?);
        if source_stamp(&source.path)?!=stamp {return Err(format!("处理期间原图发生变化，请重启后重试：{}",source.path.display()));}
        fs::write(pending.join("source.json"),serde_json::to_vec(&stamp).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
        if destination.exists() {fs::remove_dir_all(&destination).map_err(|e|e.to_string())?;}
        fs::rename(pending,&destination).map_err(|e|e.to_string())?;
        completed+=1;
        Ok(json!({"url": format!("/zoomify/{folder}/"), "width": dimensions.0, "height": dimensions.1}))
    };
    let mut locations = vec![];
    for (i, (label, images)) in sources.places.iter().enumerate() {
        let mut ready = vec![];
        for image in images {
            let mut value = convert(image)?;
            value["year"] = json!(image.label);
            ready.push(value);
        }
        locations.push(json!({"id": format!("place-{}", i + 1), "label": label, "images": ready}));
    }
    let mut maps = vec![];
    for (i, image) in sources.maps.iter().enumerate() {
        let mut value = convert(image)?;
        value["id"] = json!(format!("map-{}", i + 1));
        value["label"] = json!(image.label);
        maps.push(value);
    }
    report(json!({"phase":"ready","completed":completed,"total":11,"elapsedMs":started.elapsed().as_millis() as u64,"message":"全部地图准备完成"}));
    Ok(json!({"locations": locations, "maps": maps}))
}

