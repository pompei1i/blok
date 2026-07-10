import { useEffect, useRef, useState } from "react";
import { CheckCircle, AlertCircle } from "lucide-react";
import type { CameraQuality, ScreenShareFps, ScreenShareResolution, ScreenShareQuality } from "@/lib/store/ui-settings-store";
import { SCREEN_SHARE_FPS_OPTIONS } from "@/lib/constants";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { SectionHeader } from "./section-header";
import type { DraftTabProps } from "./types";

/**
 * Camera device/quality/preview. The tab only mounts while active, so the
 * device enumeration and preview-stream effects run on mount — no activeTab
 * guards needed (they lived in the old monolithic modal).
 */
export function VideoTab({ draft, setDraft }: DraftTabProps) {
  const { t } = useI18n();
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const previewStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then((devices) => {
      setCameraDevices(devices.filter((d) => d.kind === "videoinput"));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!draft.previewVideo) {
      previewStreamRef.current?.getTracks().forEach((t) => t.stop());
      previewStreamRef.current = null;
      if (previewVideoRef.current) previewVideoRef.current.srcObject = null;
      return;
    }
    const qualityMap: Record<string, { width: number; height: number }> = {
      "720p": { width: 1280, height: 720 },
      "1080p": { width: 1920, height: 1080 },
      "1440p": { width: 2560, height: 1440 },
    };
    const dims = qualityMap[draft.cameraQuality] ?? qualityMap["1080p"];
    const constraints: MediaTrackConstraints = {
      width: { ideal: dims.width },
      height: { ideal: dims.height },
      ...(draft.cameraDevice ? { deviceId: { exact: draft.cameraDevice } } : {}),
    };
    navigator.mediaDevices.getUserMedia({ video: constraints, audio: false }).then((stream) => {
      previewStreamRef.current?.getTracks().forEach((t) => t.stop());
      previewStreamRef.current = stream;
      if (previewVideoRef.current) previewVideoRef.current.srcObject = stream;
    }).catch(() => {});
    return () => {
      previewStreamRef.current?.getTracks().forEach((t) => t.stop());
      previewStreamRef.current = null;
    };
  }, [draft.previewVideo, draft.cameraDevice, draft.cameraQuality]);

  return (
    <div className="max-w-2xl animate-fade-in space-y-5">
      <SectionHeader title={t("settings.video.title")} subtitle={t("settings.video.subtitle")} />

      <div className="p-4 bg-[var(--bg-surface)] border border-dashed border-[var(--border)] space-y-3">
        <span className="block text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
          <span className="mr-1">&gt;</span>{t("settings.video.cameraAccess")}
        </span>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs font-mono">
            {cameraDevices.length > 0
              ? <><CheckCircle className="w-3.5 h-3.5 text-[var(--online-text)]" /><span className="text-[var(--online-text)]">{t("settings.device.accessGranted")}</span></>
              : <><AlertCircle className="w-3.5 h-3.5 text-[var(--afk)]" /><span className="text-[var(--afk)]">{t("settings.video.noCameraDetected")}</span></>
            }
          </div>
          {cameraDevices.length === 0 && (
            <button
              type="button"
              onClick={() => {
                navigator.mediaDevices.getUserMedia({ video: true }).then((s) => {
                  s.getTracks().forEach((t) => t.stop());
                  navigator.mediaDevices.enumerateDevices().then((devs) => {
                    setCameraDevices(devs.filter((d) => d.kind === "videoinput"));
                  }).catch(() => {});
                }).catch(() => {});
              }}
              className="btn-terminal text-xs px-3 py-1"
            >
              {t("settings.device.grantAccess")}
            </button>
          )}
        </div>
      </div>

      <div className="p-4 bg-[var(--bg-surface)] border border-dashed border-[var(--border)] space-y-5">
        <label className="block">
          <span className="block text-[10px] font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">
            <span className="mr-1">&gt;</span>{t("settings.video.cameraDevice")}
          </span>
          <select
            value={draft.cameraDevice}
            onChange={(e) => setDraft((prev) => ({ ...prev, cameraDevice: e.target.value }))}
            className="w-full bg-[var(--bg-base)] border-b border-[var(--border)] text-sm text-[var(--text-primary)] font-mono py-2 focus:outline-none focus:border-[var(--text-primary)] transition-colors"
          >
            <option value="">{t("settings.device.systemDefault")}</option>
            {cameraDevices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${d.deviceId.slice(0, 8)}`}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="block text-[10px] font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">
            <span className="mr-1">&gt;</span>{t("settings.video.cameraQuality")}
          </span>
          <select
            value={draft.cameraQuality}
            onChange={(e) => setDraft((prev) => ({ ...prev, cameraQuality: e.target.value as CameraQuality }))}
            className="w-full bg-[var(--bg-base)] border-b border-[var(--border)] text-sm text-[var(--text-primary)] font-mono py-2 focus:outline-none focus:border-[var(--text-primary)] transition-colors"
          >
            <option>720p</option>
            <option>1080p</option>
            <option>1440p</option>
          </select>
        </label>

        <label className="block">
          <span className="block text-[10px] font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">
            <span className="mr-1">&gt;</span>{t("settings.video.screenShareFps")}
          </span>
          <select
            value={draft.screenShareFps}
            onChange={(e) => setDraft((prev) => ({ ...prev, screenShareFps: Number(e.target.value) as ScreenShareFps }))}
            className="w-full bg-[var(--bg-base)] border-b border-[var(--border)] text-sm text-[var(--text-primary)] font-mono py-2 focus:outline-none focus:border-[var(--text-primary)] transition-colors"
          >
            {SCREEN_SHARE_FPS_OPTIONS.map((fps) => (
              <option key={fps} value={fps}>{fps} FPS</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="block text-[10px] font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">
            <span className="mr-1">&gt;</span>{t("settings.video.screenShareResolution")}
          </span>
          <select
            value={draft.screenShareResolution}
            onChange={(e) => setDraft((prev) => ({ ...prev, screenShareResolution: e.target.value as ScreenShareResolution }))}
            className="w-full bg-[var(--bg-base)] border-b border-[var(--border)] text-sm text-[var(--text-primary)] font-mono py-2 focus:outline-none focus:border-[var(--text-primary)] transition-colors"
          >
            <option value="720p">720p</option>
            <option value="1080p">1080p</option>
            <option value="1440p">1440p</option>
            <option value="native">Native</option>
          </select>
        </label>

        <label className="block">
          <span className="block text-[10px] font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">
            <span className="mr-1">&gt;</span>{t("settings.video.screenShareQuality")}
          </span>
          <select
            value={draft.screenShareQuality}
            onChange={(e) => setDraft((prev) => ({ ...prev, screenShareQuality: e.target.value as ScreenShareQuality }))}
            className="w-full bg-[var(--bg-base)] border-b border-[var(--border)] text-sm text-[var(--text-primary)] font-mono py-2 focus:outline-none focus:border-[var(--text-primary)] transition-colors"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>

        <label className="flex items-center justify-between">
          <span className="text-sm text-[var(--text-primary)] font-mono">{t("settings.video.mirrorCamera")}</span>
          <input
            type="checkbox"
            checked={draft.mirrorCamera}
            onChange={(e) => setDraft((prev) => ({ ...prev, mirrorCamera: e.target.checked }))}
          />
        </label>

        <label className="flex items-center justify-between">
          <span className="text-sm text-[var(--text-primary)] font-mono">{t("settings.video.enablePreview")}</span>
          <input
            type="checkbox"
            checked={draft.previewVideo}
            onChange={(e) => setDraft((prev) => ({ ...prev, previewVideo: e.target.checked }))}
          />
        </label>
      </div>

      {draft.previewVideo && (
        <div className="overflow-hidden bg-black aspect-video relative border border-[var(--border)]">
          <video
            ref={previewVideoRef}
            autoPlay
            playsInline
            muted
            className={cn("w-full h-full object-cover", draft.mirrorCamera && "scale-x-[-1]")}
          />
          <span className="absolute bottom-2 left-2 px-1.5 py-0.5 bg-black/60 text-[10px] font-mono text-[var(--text-muted)]">
            {t("settings.video.preview")}
          </span>
        </div>
      )}
    </div>
  );
}
