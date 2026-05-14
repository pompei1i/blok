import { useUpdater } from "../../hooks/useUpdater";

export function UpdateBanner() {
  const { available, version, body, installing, error, installUpdate, dismiss } = useUpdater();

  if (!available && !error) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] bg-[var(--accent-red)] text-white px-4 py-2 flex items-center justify-between font-mono text-sm">
      {error ? (
        <span className="text-red-200">Update error: {error}</span>
      ) : (
        <span>
          <span className="opacity-60 mr-2">$</span>
          update available — v{version}
          {body && <span className="ml-2 opacity-70 text-xs">{body}</span>}
        </span>
      )}
      <div className="flex items-center gap-3">
        {!error && (
          <button
            onClick={installUpdate}
            disabled={installing}
            className="bg-white text-[var(--accent-red)] px-3 py-0.5 rounded text-xs font-bold hover:bg-gray-100 disabled:opacity-50 disabled:cursor-wait"
          >
            {installing ? "installing..." : "install & relaunch"}
          </button>
        )}
        <button
          onClick={dismiss}
          className="opacity-60 hover:opacity-100 text-lg leading-none"
        >
          ×
        </button>
      </div>
    </div>
  );
}
