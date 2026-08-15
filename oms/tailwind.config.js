/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        primary: {
          50: '#FFEBEE',
          100: '#FFCDD2',
          500: '#E53935',
          600: '#D32F2F',
          700: '#C62828',
        },
        surface: {
          DEFAULT: '#FFFFFF',
          muted: '#F4F7FB',
          subtle: '#EEF2F7',
        },
        border: {
          DEFAULT: '#E2E8F0',
          light: '#F1F5F9',
        },
        text: {
          primary: '#0F172A',
          secondary: '#64748B',
          muted: '#94A3B8',
        },
        // backward compat
        brand: {
          50: '#FFEBEE',
          100: '#FFCDD2',
          600: '#D32F2F',
          700: '#C62828',
        },
        page: '#F4F7FB',
        sidebar: '#FFFFFF',
      },
      boxShadow: {
        soft: '0 1px 3px rgba(15,23,42,0.06), 0 4px 16px rgba(15,23,42,0.04)',
        card: '0 1px 2px rgba(15,23,42,0.05), 0 8px 24px rgba(15,23,42,0.06)',
        nav: '1px 0 0 rgba(226,232,240,0.8)',
      },
      borderRadius: {
        xl: '12px',
        '2xl': '16px',
      },
    },
  },
  plugins: [],
}
