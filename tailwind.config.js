/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          950: '#070708',
          900: '#0f0f12',
          800: '#18181f',
          700: '#22222c',
          600: '#2e2e3a',
        },
        nar: {
          red: '#e8003c',
          amber: '#f59e0b',
          green: '#22c55e',
          blue: '#3b82f6',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
