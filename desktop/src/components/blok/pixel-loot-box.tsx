// Low-poly isometric "kube" — a 3-faced red block (top highlight / left body /
// right shade) with dark facet edges. Shades derive from --accent-red, so the
// kube re-colours with the active theme (and shimmers under the fiery one).

const FACES: { points: string; fill: string }[] = [
  // top (lightest)
  { points: "16,3 28,10 16,17 4,10", fill: "color-mix(in srgb, var(--accent-red) 60%, #fff)" },
  // left (body)
  { points: "4,10 16,17 16,29 4,22", fill: "var(--accent-red)" },
  // right (shade)
  { points: "28,10 28,22 16,29 16,17", fill: "color-mix(in srgb, var(--accent-red) 58%, #000)" },
];

const EDGE = "color-mix(in srgb, var(--accent-red) 45%, #000)";

export function PixelLootBox({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      {FACES.map((f) => (
        <polygon
          key={f.points}
          points={f.points}
          style={{ fill: f.fill, stroke: EDGE, strokeWidth: 0.6, strokeLinejoin: "round" }}
        />
      ))}
    </svg>
  );
}
