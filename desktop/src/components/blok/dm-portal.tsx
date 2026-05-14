import { createPortal } from "react-dom";
import { useDMStore } from "@/lib/store/dm-store";
import { DMPopup } from "./dm-popup";
import { useEffect, useState } from "react";

export function DMPortal() {
  const openDMs = useDMStore((state) => state.openDMs);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const dmWindows = Object.values(openDMs);

  return createPortal(
    <>
      {dmWindows.map((dmState, index) => (
        <DMPopup key={dmState.userId} dmState={dmState} windowIndex={index} />
      ))}
    </>,
    document.body,
  );
}

