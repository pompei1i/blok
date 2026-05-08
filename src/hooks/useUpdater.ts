import { useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export interface UpdateState {
  available: boolean;
  version: string | null;
  body: string | null;
  installing: boolean;
  error: string | null;
}

export function useUpdater() {
  const [state, setState] = useState<UpdateState>({
    available: false,
    version: null,
    body: null,
    installing: false,
    error: null,
  });

  useEffect(() => {
    // Only run in Tauri context
    if (!("__TAURI_INTERNALS__" in window)) return;

    check()
      .then((update: Update | null) => {
        if (update?.available) {
          setState((s) => ({
            ...s,
            available: true,
            version: update.version,
            body: update.body ?? null,
          }));
        }
      })
      .catch((err: unknown) => {
        // Silently ignore update check failures (offline, bad config, etc.)
        console.warn("Update check failed:", err);
      });
  }, []);

  const installUpdate = async () => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    setState((s) => ({ ...s, installing: true, error: null }));
    try {
      const update: Update | null = await check();
      if (update?.available) {
        await update.downloadAndInstall();
        await relaunch();
      }
    } catch (err: unknown) {
      setState((s) => ({
        ...s,
        installing: false,
        error: err instanceof Error ? err.message : "Update failed",
      }));
    }
  };

  const dismiss = () => setState((s) => ({ ...s, available: false }));

  return { ...state, installUpdate, dismiss };
}
