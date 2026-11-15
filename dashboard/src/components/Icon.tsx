import type { ReactNode } from 'react';

// Minimal stroke icon set (24x24), drawn inline so no icon package is needed.
const PATHS = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  map: (
    <>
      <path d="M9 4 3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5L9 4Z" />
      <path d="M9 4v13.5M15 6.5V20" />
    </>
  ),
  list: (
    <>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3.5 2.5 20h19L12 3.5Z" />
      <path d="M12 10v4.5M12 17.5h.01" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s7-6.1 7-11.5a7 7 0 1 0-14 0C5 14.900 12 21 12 21Z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </>
  ),
  route: (
    <>
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <path d="M8.500 18H15a3.500 3.500 0 0 0 0-7H9a3.500 3.500 0 0 1 0-7h6.500" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.500" />
      <path d="M2.500 20a6.500 6.500 0 0 1 13 0" />
      <path d="M16 4.700a3.500 3.500 0 0 1 0 6.600M18 14.200a6.500 6.500 0 0 1 3.500 5.800" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 4.500 6v5.500c0 4.600 3.100 8 7.500 9.500 4.400-1.500 7.500-4.900 7.500-9.500V6L12 3Z" />
      <path d="m9 12 2.200 2.200L15.200 10" />
    </>
  ),
  logout: (
    <>
      <path d="M15 4h3.500A1.500 1.500 0 0 1 20 5.500v13a1.500 1.500 0 0 1-1.500 1.500H15" />
      <path d="M10 8l-4 4 4 4M6 12h9" />
    </>
  ),
  play: <path d="M7 4.500v15l12-7.500-12-7.500Z" />,
  pause: <path d="M8 5v14M16 5v14" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="1.500" />,
  cube: (
    <>
      <path d="m12 3 8 4.500v9L12 21l-8-4.500v-9L12 3Z" />
      <path d="m4 7.500 8 4.500 8-4.500M12 12v9" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.500" />
      <path d="M12 7.500V12l3 2" />
    </>
  ),
  check: <path d="m5 12.500 4.500 4.500L19 7.500" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  qr: (
    <>
      <rect x="3.500" y="3.500" width="6.500" height="6.500" rx="1" />
      <rect x="14" y="3.500" width="6.500" height="6.500" rx="1" />
      <rect x="3.500" y="14" width="6.500" height="6.500" rx="1" />
      <path d="M14 14h2.500v2.500H14zM18 18h2.500v2.500H18zM18 14h2.500M14 18v2.500" />
    </>
  ),
  eye: (
    <>
      <path d="M2.500 12S6 5.500 12 5.500 21.500 12 21.500 12 18 18.500 12 18.500 2.500 12 2.500 12Z" />
      <circle cx="12" cy="12" r="2.800" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M4 4l16 16M9.900 5.800A9 9 0 0 1 12 5.500c6 0 9.500 6.500 9.500 6.500a15 15 0 0 1-3 3.700M6.300 7.700A15 15 0 0 0 2.500 12S6 18.500 12 18.500a9 9 0 0 0 3.300-.600" />
      <path d="M9.900 9.900a2.800 2.800 0 0 0 4 4" />
    </>
  ),
  menu: <path d="M4 6.500h16M4 12h16M4 17.500h16" />,
  printer: (
    <>
      <path d="M7 8V3.500h10V8M7 17H5a1.500 1.500 0 0 1-1.500-1.500v-6A1.500 1.500 0 0 1 5 8h14a1.500 1.500 0 0 1 1.500 1.500v6A1.500 1.500 0 0 1 19 17h-2" />
      <rect x="7" y="13.500" width="10" height="7" rx="1" />
    </>
  ),
  undo: <path d="M8 5 4 9l4 4M4 9h10a5 5 0 0 1 0 10h-3" />,
  plus: <path d="M12 5v14M5 12h14" />,
  info: (
    <>
      <circle cx="12" cy="12" r="8.500" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  activity: <path d="M3 12h4l2.500-7 5 14 2.500-7h4" />,
  scan: (
    <>
      <path d="M4 8V5.500A1.500 1.500 0 0 1 5.500 4H8M16 4h2.500A1.500 1.500 0 0 1 20 5.500V8M20 16v2.500a1.500 1.500 0 0 1-1.500 1.500H16M8 20H5.500A1.500 1.500 0 0 1 4 18.500V16" />
      <path d="M8 12h8" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 18,
  className = '',
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`shrink-0 ${className}`}
    >
      {PATHS[name]}
    </svg>
  );
}
