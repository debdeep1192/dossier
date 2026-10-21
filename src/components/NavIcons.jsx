// Navigation icons — one consistent set (24px grid, 1.6 stroke, round
// caps) replacing the emoji that rendered differently on every
// platform. Inline SVG, currentColor, so active/inactive colour comes
// from CSS and there is no extra request or dependency.
const base = {
  width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round',
  'aria-hidden': 'true', focusable: 'false',
};

// Home — a compass: the desk you start each expedition from.
export function HomeIcon() {
  return (
    <svg {...base}>
      <circle cx="12" cy="12" r="9" />
      <path d="M15.6 8.4 13.4 13.4 8.4 15.6 10.6 10.6Z" />
      <circle cx="12" cy="12" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

// Plannings — a route between two waypoints.
export function PlanningIcon() {
  return (
    <svg {...base}>
      <circle cx="6" cy="18" r="2.2" />
      <circle cx="18" cy="6" r="2.2" />
      <path d="M8.2 18H14a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h5.8" strokeDasharray="0.1 3.2" />
    </svg>
  );
}

// Travellers — two figures.
export function TravellersIcon() {
  return (
    <svg {...base}>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3.5 19.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <circle cx="17" cy="9.5" r="2.3" />
      <path d="M16.2 14.7c2.6-.3 4.8 1.4 4.8 4.3" />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg {...base} width="26" height="26" strokeWidth="2.2">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
