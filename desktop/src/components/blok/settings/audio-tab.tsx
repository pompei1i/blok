import { useEffect, useState } from "react";
import { CheckCircle, XCircle, AlertCircle, ExternalLink, Wifi, Loader2 } from "lucide-react";
import { testTurnConnectivity } from "@/lib/native-voice-engine";
import { useI18n } from "@/lib/i18n";
import { SectionHeader } from "./section-header";
import type { DraftTabProps } from "./types";

/** Mic/output devices, voice processing toggles, TURN connectivity test. */
export function AudioTab({ draft, setDraft }: DraftTabProps) {
  const { t } = useI18n();
  const [inputDevices, setInputDevices] = useState<string[]>([]);
  const [outputDevices, setOutputDevices] = useState<string[]>([]);
  const [micPermission, setMicPermission] = useState<"granted" | "denied" | "prompt" | "checking">("checking");
  const [connTest, setConnTest] = useState<{
    status: "idle" | "testing" | "ok" | "fail";
    detail?: string;
  }>({ status: "idle" });

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    import("@tauri-apps/api/core").then(({ invoke }) => {
      invoke<string[]>("audio_list_input_devices").then(setInputDevices).catch(() => {});
      invoke<string[]>("audio_list_output_devices").then(setOutputDevices).catch(() => {});
    });
  }, []);

  useEffect(() => {
    if (!navigator.permissions) { setMicPermission("prompt"); return; }
    navigator.permissions
      .query({ name: "microphone" as PermissionName })
      .then((result) => {
        setMicPermission(result.state as "granted" | "denied" | "prompt");
        result.onchange = () => setMicPermission(result.state as "granted" | "denied" | "prompt");
      })
      .catch(() => setMicPermission("prompt"));
  }, []);

  const requestMicPermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setMicPermission("granted");
    } catch {
      setMicPermission("denied");
    }
  };

  const runConnectionTest = async () => {
    setConnTest({ status: "testing" });
    try {
      const r = await testTurnConnectivity();
      setConnTest({ status: r.ok ? "ok" : "fail", detail: r.detail });
    } catch {
      setConnTest({ status: "fail", detail: "Test could not run" });
    }
  };

  return (
    <div className="max-w-2xl animate-fade-in space-y-5">
      <SectionHeader title={t("settings.audio.title")} subtitle={t("settings.audio.subtitle")} />

      <div className="p-4 bg-[var(--bg-surface)] border border-dashed border-[var(--border)] space-y-3">
        <span className="block text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
          <span className="mr-1">&gt;</span>{t("settings.audio.microphoneAccess")}
        </span>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs font-mono">
            {micPermission === "granted" && <><CheckCircle className="w-3.5 h-3.5 text-[var(--online-text)]" /><span className="text-[var(--online-text)]">{t("settings.device.accessGranted")}</span></>}
            {micPermission === "denied" && <><XCircle className="w-3.5 h-3.5 text-[var(--accent-red-text)]" /><span className="text-[var(--accent-red-text)]">{t("settings.device.accessDenied")}</span></>}
            {micPermission === "prompt" && <><AlertCircle className="w-3.5 h-3.5 text-[var(--afk)]" /><span className="text-[var(--afk)]">{t("settings.device.notYetRequested")}</span></>}
            {micPermission === "checking" && <><AlertCircle className="w-3.5 h-3.5 text-[var(--text-muted)]" /><span className="text-[var(--text-muted)]">{t("settings.device.checking")}</span></>}
          </div>
          {micPermission !== "granted" && (
            <div className="flex gap-2">
              {micPermission === "denied" ? (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const { openUrl } = await import("@tauri-apps/plugin-opener");
                      await openUrl("ms-settings:privacy-microphone");
                    } catch { /* not in Tauri or failed */ }
                  }}
                  className="btn-terminal flex items-center gap-1.5 text-xs px-3 py-1"
                >
                  <ExternalLink className="w-3 h-3" />
                  {t("settings.device.openSystemSettings")}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={requestMicPermission}
                  className="btn-terminal text-xs px-3 py-1"
                >
                  {t("settings.device.requestAccess")}
                </button>
              )}
            </div>
          )}
        </div>
        {micPermission === "denied" && (
          <p className="text-xs text-[var(--text-muted)] font-mono">
            {t("settings.audio.micPermHint")}
          </p>
        )}
      </div>

      <div className="p-4 bg-[var(--bg-surface)] border border-dashed border-[var(--border)] space-y-5">
        <label className="block">
          <span className="block text-[10px] font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">
            <span className="mr-1">&gt;</span>{t("settings.audio.inputDevice")}
          </span>
          <select
            value={draft.inputDevice}
            onChange={(e) => setDraft((prev) => ({ ...prev, inputDevice: e.target.value }))}
            className="w-full bg-[var(--bg-base)] border-b border-[var(--border)] text-sm text-[var(--text-primary)] font-mono py-2 focus:outline-none focus:border-[var(--text-primary)] transition-colors"
          >
            <option value="">{t("settings.device.systemDefault")}</option>
            {inputDevices.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-[10px] font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">
            <span className="mr-1">&gt;</span>{t("settings.audio.outputDevice")}
          </span>
          <select
            value={draft.outputDevice}
            onChange={(e) => setDraft((prev) => ({ ...prev, outputDevice: e.target.value }))}
            className="w-full bg-[var(--bg-base)] border-b border-[var(--border)] text-sm text-[var(--text-primary)] font-mono py-2 focus:outline-none focus:border-[var(--text-primary)] transition-colors"
          >
            <option value="">{t("settings.device.systemDefault")}</option>
            {outputDevices.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="p-4 bg-[var(--bg-surface)] border border-dashed border-[var(--border)] space-y-5">
        <label className="flex items-center justify-between">
          <span className="text-sm text-[var(--text-primary)] font-mono">{t("settings.audio.noiseSuppression")}</span>
          <input
            type="checkbox"
            checked={draft.noiseSuppression}
            onChange={(e) => setDraft((prev) => ({ ...prev, noiseSuppression: e.target.checked }))}
          />
        </label>
        <label className="flex items-center justify-between">
          <span className="text-sm text-[var(--text-primary)] font-mono">{t("settings.audio.echoCancellation")}</span>
          <input
            type="checkbox"
            checked={draft.echoCancellation}
            onChange={(e) => setDraft((prev) => ({ ...prev, echoCancellation: e.target.checked }))}
          />
        </label>
        <label className="block">
          <span className="block text-[10px] font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">
            <span className="mr-1">&gt;</span>{t("settings.audio.inputVolume")}: {draft.inputVolume}%
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={draft.inputVolume}
            onChange={(e) => setDraft((prev) => ({ ...prev, inputVolume: Number(e.target.value) }))}
            className="w-full"
          />
        </label>
        <label className="block">
          <span className="block text-[10px] font-semibold text-[var(--text-muted)] mb-1 uppercase tracking-wider">
            <span className="mr-1">&gt;</span>{t("settings.audio.noiseGate")}: {draft.noiseGateThreshold === 0 ? t("settings.audio.noiseGateOff") : `${draft.noiseGateThreshold}%`}
          </span>
          <p className="text-xs text-[var(--text-muted)] mb-2 font-mono">{t("settings.audio.noiseGateHint")}</p>
          <input
            type="range"
            min={0}
            max={100}
            value={draft.noiseGateThreshold}
            onChange={(e) => setDraft((prev) => ({ ...prev, noiseGateThreshold: Number(e.target.value) }))}
            className="w-full"
          />
        </label>
      </div>

      <div className="p-4 bg-[var(--bg-surface)] border border-dashed border-[var(--border)] space-y-3">
        <span className="block text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
          <span className="mr-1">&gt;</span>connection test
          <span className="ml-2 text-[var(--accent-red-text)] normal-case tracking-normal">(beta)</span>
        </span>
        <p className="text-xs text-[var(--text-muted)] font-mono">
          Checks that the relay (TURN) server is reachable. If this passes, voice / screen share / camera will connect even behind strict networks.
        </p>
        <div className="flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={runConnectionTest}
            disabled={connTest.status === "testing"}
            className="btn-terminal flex items-center gap-1.5 text-xs px-3 py-1 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {connTest.status === "testing"
              ? <Loader2 className="w-3 h-3 animate-spin" />
              : <Wifi className="w-3 h-3" />}
            {connTest.status === "testing" ? "testing…" : "test connection"}
          </button>
          {connTest.status === "ok" && (
            <div className="flex items-center gap-1.5 text-xs font-mono text-[var(--online-text)] text-right">
              <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{connTest.detail}</span>
            </div>
          )}
          {connTest.status === "fail" && (
            <div className="flex items-center gap-1.5 text-xs font-mono text-[var(--accent-red-text)] text-right">
              <XCircle className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{connTest.detail}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
