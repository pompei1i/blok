import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAuthStore } from "./lib/store/auth-store";
import { useFriendsStore } from "./lib/store/friends-store";
import { useServerStore } from "./lib/store/server-store";
import { getActiveNativeVoiceEngine } from "./lib/native-voice-engine";
import { requestNotificationPermission } from "./lib/notifications";
import { AuthScreen } from "./components/blok/auth-screen";
import { AppLayout } from "./components/blok/app-layout";
import { useUiSettingsStore } from "./lib/store/ui-settings-store";
import { UpdateBanner } from "./components/blok/update-banner";

function App() {
  const { isAuthenticated, init, initialized, user } = useAuthStore();
  const { uiScale, compactMode, themeMode, customCss, pushToTalk, inputVolume } = useUiSettingsStore();
  const { isMuted, toggleMute } = useServerStore();
  const [audioError, setAudioError] = useState<string | null>(null);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    if ("__TAURI_INTERNALS__" in window) {
      invoke("disable_audio_ducking").catch(() => {});
    }
    void requestNotificationPermission();
  }, []);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let unlisten: (() => void) | null = null;
    void listen<string>("audio-error", (e) => {
      setAudioError(e.payload);
      setTimeout(() => setAudioError(null), 6000);
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  useEffect(() => {
    document.documentElement.style.fontSize = `${uiScale}%`;
    document.documentElement.setAttribute("data-compact-mode", compactMode ? "true" : "false");
    document.documentElement.setAttribute("data-theme-mode", themeMode);
  }, [uiScale, compactMode, themeMode]);

  useEffect(() => {
    let el = document.getElementById("blok-custom-css") as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = "blok-custom-css";
      document.head.appendChild(el);
    }
    el.textContent = customCss;
  }, [customCss]);

  useEffect(() => {
    if (!user) return;
    const userId = user.id;
    const goOffline = () => {
      void useFriendsStore.getState().updatePresence(userId, "offline");
      void useServerStore.getState().leaveVoiceChannel();
    };

    // Web: page unload
    window.addEventListener("beforeunload", goOffline);

    // Tauri tray "Quit" — emits this event then exits after 1 s
    let tauriUnlisten: (() => void) | null = null;
    if ("__TAURI_INTERNALS__" in window) {
      void listen<void>("app:quitting", goOffline).then((fn) => {
        tauriUnlisten = fn;
      });
    }

    return () => {
      window.removeEventListener("beforeunload", goOffline);
      tauriUnlisten?.();
    };
  // user?.id: only re-run when the user identity changes, not on profile edits
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Push-to-talk: Space = unmute while held, mute on release
  useEffect(() => {
    if (!pushToTalk) return;
    const onDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      if (isMuted) toggleMute();
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      if (!isMuted) toggleMute();
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [pushToTalk, isMuted, toggleMute]);

  // Live input volume update when slider changes
  useEffect(() => {
    getActiveNativeVoiceEngine()?.setInputVolume(inputVolume);
  }, [inputVolume]);

  if (!initialized) {
    return (
      <div className="min-h-screen bg-[var(--bg-base)] flex items-center justify-center">
        <div className="text-center text-[var(--text-muted)] font-mono text-sm">
          <span className="cursor-blink mr-2">$</span> booting blok...
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <AuthScreen />;
  }

  return (
    <>
      <UpdateBanner />
      {audioError && (
        <div className="fixed top-2 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-3 px-4 py-2.5 bg-[var(--destructive)] text-white text-xs rounded-lg shadow-lg font-mono">
          <span>audio device error — rejoin voice to restore</span>
          <button onClick={() => setAudioError(null)} className="opacity-70 hover:opacity-100 transition-opacity">✕</button>
        </div>
      )}
      <AppLayout />
    </>
  );
}

export default App;
