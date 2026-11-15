/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Interface chrome: cool neutrals + corporate navy.
        surface: '#ffffff',
        plane: '#f3f5f8',
        ink: '#111827',
        'ink-2': '#4b5563',
        muted: '#6b7280',
        grid: '#e3e7ed',
        navy: { DEFAULT: '#0f1c2e', 2: '#18293f', 3: '#243a57' },
        primary: { DEFAULT: '#1d4f91', dark: '#173f75', soft: '#e8eff8' },
        // Data marks (validated chart palette) — do not reuse for chrome.
        series: '#2a78d6',
        good: '#0ca30c',
        critical: '#d03b3b',
        warning: '#fab219',
        // Text-safe variants of the status hues for badges and messages.
        'good-ink': '#166534',
        'critical-ink': '#b42318',
        'warning-ink': '#92400e',
      },
      boxShadow: {
        card: '0 1px 2px rgba(16, 24, 40, 0.05)',
        pop: '0 12px 32px rgba(16, 24, 40, 0.18)',
      },
    },
  },
  plugins: [],
};
