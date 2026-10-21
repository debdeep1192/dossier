// The Debdeep Travels mark: a survey bearing on contour rings.
// Inline SVG so it inherits sizing from CSS and needs no request.
// Same artwork as public/favicon.svg (kept visually in step by hand).
// Decorative by default (aria-hidden) — the wordmark beside it carries
// the accessible name.
const RING = (cx, cy, r, phase, amp, n = 48) => {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n;
    const rr = r * (1 + amp * Math.sin(2 * t + phase) + 0.5 * amp * Math.sin(3 * t + phase * 1.7));
    pts.push(`${(cx + rr * Math.cos(t)).toFixed(1)} ${(cy + rr * Math.sin(t)).toFixed(1)}`);
  }
  return `M${pts.join(' L')} Z`;
};

const RINGS = [
  { d: RING(30, 34, 8, 0.6, 0.07), w: 2.2, o: 1 },
  { d: RING(30, 34, 15, 0.6, 0.07), w: 1.6, o: 0.8 },
  { d: RING(30, 34, 22, 0.6, 0.07), w: 1.4, o: 0.55 },
];

export default function BrandMark({ size = 36, className = '' }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="13" fill="var(--abyss)" />
      <g fill="none" strokeLinejoin="round" stroke="var(--glacial)">
        {RINGS.map(r => <path key={r.w} d={r.d} strokeWidth={r.w} strokeOpacity={r.o} />)}
      </g>
      <path d="M44 12 L50 24 L44 21.5 L38 24 Z" fill="var(--orange)" />
      <circle cx="44" cy="21.2" r="1.6" fill="var(--abyss)" />
    </svg>
  );
}
