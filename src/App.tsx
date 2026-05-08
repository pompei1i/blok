import { useEffect } from "react";
import { useAuthStore } from "./lib/store/auth-store";
import { useFriendsStore } from "./lib/store/friends-store";
import { useServerStore } from "./lib/store/server-store";
import { getActiveVoiceEngine } from "./lib/voice-engine";
import { AuthScreen } from "./components/blok/auth-screen";
import { AppLayout } from "./components/blok/app-layout";
import { useUiSettingsStore } from "./lib/store/ui-settings-store";
import { UpdateBanner } from "./components/blok/update-banner";

function App() {
  const { isAuthenticated, init, initialized, user } = useAuthStore();
  const { uiScale, compactMode, themeMode, customCss, pushToTalk, inputVolume } = useUiSettingsStore();
  const { isMuted, toggleMute } = useServerStore();

  useEffect(() => {
    void init();
  }, [init]);

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
    const setOffline = () => {
      useFriendsStore.getState().updatePresence(user.id, "offline");
    };
    window.addEventListener("beforeunload", setOffline);
    return () => window.removeEventListener("beforeunload", setOffline);
  }, [user]);

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
    getActiveVoiceEngine()?.setInputVolume(inputVolume);
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
      <AppLayout />
    </>
  );
}

export default App;
