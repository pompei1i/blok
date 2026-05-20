import { useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { UPDATER_CHECK_DELAY_MS } from "@/lib/constants";

// 3 s → 30 s → 5 min — stops after the last delay whether it succeeds or fails
const RETRY_DELAYS_MS = [UPDATER_CHECK_DELAY_MS, 30_000, 5 * 60_000];

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
    if (!("__TAURI_INTERNALS__" in window)) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tryCheck = (attempt: number) => {
      timer = setTimeout(async () => {
        if (cancelled) return;
        try {
          const update: Update | null = await check();
          if (cancelled) return;
          if (update?.available) {
            setState((s) => ({
              ...s,
              available: true,
              version: update.version,
              body: update.body ?? null,
            }));
            return;
          }
          if (attempt + 1 < RETRY_DELAYS_MS.length) tryCheck(attempt + 1);
        } catch (err: unknown) {
          if (cancelled) return;
          console.warn(`Update check failed (attempt ${attempt + 1}):`, err);
          if (attempt + 1 < RETRY_DELAYS_MS.length) tryCheck(attempt + 1);
          // Silent fail after last attempt — background check errors are not user-facing
        }
      }, RETRY_DELAYS_MS[attempt]);
    };

    tryCheck(0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
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
