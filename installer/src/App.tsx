import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

type Screen = "loading" | "welcome" | "downloading" | "installing" | "done" | "error";

const ASCII = `\
 ██████╗ ██╗      ██████╗ ██╗  ██╗
 ██╔══██╗██║     ██╔═══██╗██║ ██╔╝
 ██████╔╝██║     ██║   ██║█████╔╝
 ██╔══██╗██║     ██║   ██║██╔═██╗
 ██████╔╝███████╗╚██████╔╝██║  ██╗
 ╚═════╝ ╚══════╝ ╚═════╝ ╚═╝  ╚═╝`;

export default function App() {
  const [screen, setScreen]       = useState<Screen>("loading");
  const [version, setVersion]     = useState("latest");
  const [downloadUrl, setUrl]     = useState("");
  const [installPath, setPath]    = useState("");
  const [error, setError]         = useState("");
  const [countdown, setCountdown] = useState(5);
  const countdownRef              = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    invoke<string>("get_default_install_path").then(setPath).catch(() => {});

    // Get the download URL from the release manifest via Rust (curl) — avoids the
    // GitHub API's anonymous rate limit and webview CORS that broke this before.
    invoke<string>("fetch_latest_json")
      .then((text) => {
        const data = JSON.parse(text) as {
          version?: string;
          platforms?: Record<string, { url?: string }>;
        };
        if (data.version) setVersion(`v${data.version}`);
        const url = data.platforms?.["windows-x86_64"]?.url;
        if (url) setUrl(url);
        setScreen("welcome");
      })
      .catch(() => setScreen("welcome"));

    const u1 = listen<string>("install-status", (e) => {
      if (e.payload === "installing") setScreen("installing");
      if (e.payload === "done") {
        setScreen("done");
        // auto-close countdown
        let t = 5;
        setCountdown(t);
        countdownRef.current = setInterval(() => {
          t -= 1;
          setCountdown(t);
          if (t <= 0) {
            clearInterval(countdownRef.current!);
            invoke("close_app").catch(() => {});
          }
        }, 1000);
      }
    });

    return () => {
      u1.then((f) => f());
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  // ── actions ───────────────────────────────────────────────────────────────
  const browse = async () => {
    const selected = await open({ directory: true, title: "Choose install folder" });
    if (selected) setPath(selected as string);
  };

  const install = async () => {
    if (!downloadUrl) { setError("no download URL found"); setScreen("error"); return; }
    setScreen("downloading");
    try {
      await invoke("download_and_install", { url: downloadUrl, installPath });
    } catch (e) {
      setError(String(e));
      setScreen("error");
    }
  };

  const launch = async () => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    try { await invoke("launch_blok", { installPath }); } catch { /* ignore */ }
    invoke("close_app").catch(() => {});
  };

  const close = () => invoke("close_app").catch(() => {});

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div className="root">
      {/* titlebar — drag region */}
      <div className="titlebar" data-tauri-drag-region>
        <span className="titlebar-label" data-tauri-drag-region>~/blok</span>
        <button className="close-btn" onMouseDown={(e) => e.stopPropagation()} onClick={close}>
          ✕
        </button>
      </div>

      <div className="content">
        <pre className="ascii">{ASCII}</pre>

        {screen === "loading" && (
          <p className="status">connecting...</p>
        )}

        {screen === "welcome" && (<>
          <p className="tagline">desktop communication platform</p>
          <p className="version-tag">{version} · Windows x64</p>

          <div className="path-row">
            <span className="path-text" title={installPath}>{installPath}</span>
            <button className="path-browse" onClick={browse}>browse</button>
          </div>

          <button className="btn" onClick={install}>install</button>
        </>)}

        {screen === "downloading" && (<>
          <p className="status">~/blok $ downloading {version}...</p>
          <div className="progress-wrap">
            <div className="progress-track">
              <div className="progress-bar indeterminate" />
            </div>
          </div>
        </>)}

        {screen === "installing" && (<>
          <p className="status">~/blok $ installing...</p>
          <div className="progress-wrap">
            <div className="progress-track">
              <div className="progress-bar" style={{ width: "100%" }} />
            </div>
          </div>
        </>)}

        {screen === "done" && (<>
          <p className="status"><span className="check">[✓]</span> installation complete</p>
          <button className="btn" onClick={launch}>launch blok</button>
          <p className="version-tag">closing in {countdown}s...</p>
        </>)}

        {screen === "error" && (<>
          <p className="status error">error: {error}</p>
          <button className="btn" onClick={() => setScreen("welcome")}>retry</button>
        </>)}
      </div>
    </div>
  );
}
