// Low-poly gold coin — octagon disc with a stamped centre bar (NES-coin vibe).
// Pairs with the kube; fixed gold so it always reads as currency.

export function CoinIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden>
      {/* rim */}
      <polygon
        points="5,1 11,1 15,5 15,11 11,15 5,15 1,11 1,5"
        style={{ fill: "#9a6c08", stroke: "#6e4d05", strokeWidth: 0.5, strokeLinejoin: "round" }}
      />
      {/* face */}
      <polygon points="6,2.6 10,2.6 13.4,6 13.4,10 10,13.4 6,13.4 2.6,10 2.6,6" style={{ fill: "#f6c83c" }} />
      {/* top highlight facet */}
      <polygon points="6,2.6 10,2.6 8,5" style={{ fill: "#ffe79a" }} />
      {/* centre stamp */}
      <rect x="7" y="4.6" width="2" height="6.8" rx="0.4" style={{ fill: "#9a6c08" }} />
    </svg>
  );
}
