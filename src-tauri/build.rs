fn main() {
    println!("cargo:rerun-if-changed=windows.manifest");
    let mut attributes = tauri_build::Attributes::new();
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        attributes = attributes.windows_attributes(
            tauri_build::WindowsAttributes::new().app_manifest(include_str!("windows.manifest")),
        );
    }
    tauri_build::try_build(attributes).expect("展厅应用原生资源构建失败");
}
