import { cn } from "@/lib/utils";

interface Props {
  shape: string;
  color: string;
  color2?: string;
  className?: string;
}

export function AvatarFrameSVG({ shape, color, color2, className }: Props) {
  const cx = 50;
  const cy = 50;
  // avatarR = 50 means the frame elements start exactly at the viewBox edge.
  // SVG has overflow:visible so elements beyond the edge render outside the avatar div.
  const avatarR = 50;

  let content: React.ReactNode = null;

  if (shape === "ring") {
    content = (
      <circle
        cx={cx} cy={cy}
        r={avatarR + 2.5}
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        strokeDasharray="5 3"
        strokeLinecap="round"
      />
    );
  } else if (shape === "hex") {
    const R = avatarR + 4;
    const points = Array.from({ length: 6 }, (_, i) => {
      const a = (i * 60 - 30) * (Math.PI / 180);
      return `${(cx + R * Math.cos(a)).toFixed(2)},${(cy + R * Math.sin(a)).toFixed(2)}`;
    }).join(" ");
    content = (
      <polygon
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
      />
    );
  } else if (shape === "crystal") {
    const baseR = avatarR + 1.5;
    const tipR = avatarR + 11;
    const halfW = 2.5;
    content = (
      <>
        <circle cx={cx} cy={cy} r={baseR} fill="none" stroke={color} strokeWidth="1.5" opacity={0.5} />
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i * 45) * (Math.PI / 180);
          const perp = a + Math.PI / 2;
          const bx = cx + baseR * Math.cos(a);
          const by = cy + baseR * Math.sin(a);
          const tx = cx + tipR * Math.cos(a);
          const ty = cy + tipR * Math.sin(a);
          return (
            <polygon
              key={i}
              points={[
                `${(bx + halfW * Math.cos(perp)).toFixed(2)},${(by + halfW * Math.sin(perp)).toFixed(2)}`,
                `${tx.toFixed(2)},${ty.toFixed(2)}`,
                `${(bx - halfW * Math.cos(perp)).toFixed(2)},${(by - halfW * Math.sin(perp)).toFixed(2)}`,
              ].join(" ")}
              fill={color}
            />
          );
        })}
      </>
    );
  } else if (shape === "orbit") {
    const orbitR = avatarR + 8;
    const c2 = color2 ?? color;
    content = (
      <>
        <circle cx={cx} cy={cy} r={avatarR + 1.5} fill="none" stroke={color} strokeWidth="1.5" />
        <circle cx={cx} cy={cy} r={orbitR} fill="none" stroke={`${color}33`} strokeWidth="1" />
        <g>
          <animateTransform
            attributeName="transform"
            type="rotate"
            from={`0 ${cx} ${cy}`}
            to={`360 ${cx} ${cy}`}
            dur="3s"
            repeatCount="indefinite"
          />
          <circle cx={cx} cy={cy - orbitR} r="3" fill={color} />
        </g>
        <g>
          <animateTransform
            attributeName="transform"
            type="rotate"
            from={`180 ${cx} ${cy}`}
            to={`540 ${cx} ${cy}`}
            dur="5s"
            repeatCount="indefinite"
          />
          <circle cx={cx} cy={cy - orbitR} r="2" fill={c2} opacity={0.75} />
        </g>
      </>
    );
  }

  if (!content) return null;

  return (
    <svg
      viewBox="0 0 100 100"
      className={cn("absolute inset-0 w-full h-full pointer-events-none", className)}
      style={{ overflow: "visible" }}
      aria-hidden
    >
      {content}
    </svg>
  );
}
