#[cfg(not(feature = "cli"))]
fn verify_mcp_excalidraw_dist() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR")
        .expect("CARGO_MANIFEST_DIR must be set during build");
    let dist_path = std::path::Path::new(&manifest_dir)
        .join("resources/mcp_excalidraw/dist/index.js");

    println!("cargo:rerun-if-changed=resources/mcp_excalidraw/dist/index.js");

    let missing_msg = "mcp_excalidraw dist missing or empty \u{2014} run `cd src-tauri/resources/mcp_excalidraw && npm ci && npm run build` to rebuild";

    match std::fs::metadata(&dist_path) {
        Ok(meta) => {
            if meta.len() == 0 {
                panic!("{}", missing_msg);
            }
        }
        Err(_) => {
            panic!("{}", missing_msg);
        }
    }
}

fn main() {
    #[cfg(not(feature = "cli"))]
    {
        verify_mcp_excalidraw_dist();
        tauri_build::build();
    }

    #[cfg(target_os = "macos")]
    {
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");

        if let Ok(output) = std::process::Command::new("xcrun")
            .args(["--toolchain", "default", "--find", "swift"])
            .output()
        {
            let swift_path = String::from_utf8_lossy(&output.stdout)
                .trim()
                .to_string();
            if let Some(toolchain) = std::path::Path::new(&swift_path)
                .parent()
                .and_then(|p| p.parent())
            {
                let lib_path = toolchain.join("lib/swift/macosx");
                if lib_path.exists() {
                    println!(
                        "cargo:rustc-link-arg=-Wl,-rpath,{}",
                        lib_path.display()
                    );
                }
            }
        }
    }
}
