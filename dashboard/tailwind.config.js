/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: '#fcfcfb',
        plane: '#f9f9f7',
        ink: '#0b0b0b',
        'ink-2': '#52514e',
        muted: '#898781',
        grid: '#e1e0d9',
        series: '#2a78d6',
        good: '#0ca30c',
        critical: '#d03b3b',
        warning: '#fab219',
      },
    },
  },
  plugins: [],
};
