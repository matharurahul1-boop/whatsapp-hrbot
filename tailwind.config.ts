import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // ── Brand ──────────────────────────────────────────
        brand: {
          50:  '#ecfdf5',
          100: '#d1fae5',
          200: '#a7f3d0',
          300: '#6ee7b7',
          400: '#34d399',
          500: '#10b981',
          600: '#059669',
          700: '#047857',
          800: '#065f46',
          900: '#064e3b',
          950: '#022c22',
        },
        // ── Themeable surface palette (controlled via CSS vars in globals.css) ──
        surface: {
          0:    'rgb(var(--s0)   / <alpha-value>)',
          50:   'rgb(var(--s50)  / <alpha-value>)',
          100:  'rgb(var(--s100) / <alpha-value>)',
          200:  'rgb(var(--s200) / <alpha-value>)',
          300:  'rgb(var(--s300) / <alpha-value>)',
          400:  'rgb(var(--s400) / <alpha-value>)',
          500:  'rgb(var(--s500) / <alpha-value>)',
          600:  'rgb(var(--s600) / <alpha-value>)',
          700:  'rgb(var(--s700) / <alpha-value>)',
          800:  'rgb(var(--s800) / <alpha-value>)',
          900:  'rgb(var(--s900) / <alpha-value>)',
          950:  'rgb(var(--s950) / <alpha-value>)',
        },
        // ── Semantic ───────────────────────────────────────
        success: { DEFAULT: '#10b981', fg: '#d1fae5', muted: '#064e3b' },
        warning: { DEFAULT: '#f59e0b', fg: '#fef3c7', muted: '#451a03' },
        danger:  { DEFAULT: '#ef4444', fg: '#fee2e2', muted: '#450a0a' },
        info:    { DEFAULT: '#6366f1', fg: '#e0e7ff', muted: '#1e1b4b' },
      },
      fontFamily: {
        sans:  ['Inter var', 'Inter', 'system-ui', 'sans-serif'],
        mono:  ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
      },
      borderRadius: {
        '4xl': '2rem',
      },
      boxShadow: {
        'glow-sm':  '0 0 8px 0 rgba(16, 185, 129, 0.15)',
        'glow':     '0 0 20px 0 rgba(16, 185, 129, 0.2)',
        'glow-lg':  '0 0 40px 0 rgba(16, 185, 129, 0.25)',
        'card':     '0 1px 0 0 rgba(255,255,255,0.04), 0 4px 24px 0 rgba(0,0,0,0.4)',
        'card-hover': '0 1px 0 0 rgba(255,255,255,0.06), 0 8px 32px 0 rgba(0,0,0,0.5)',
        'modal':    '0 24px 80px 0 rgba(0,0,0,0.7)',
        'inner-sm': 'inset 0 1px 0 0 rgba(255,255,255,0.06)',
      },
      backgroundImage: {
        'gradient-radial':  'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic':   'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
        'glass-card':       'linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)',
        'glass-hover':      'linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)',
        'brand-gradient':   'linear-gradient(135deg, #10b981 0%, #059669 100%)',
        'surface-gradient': 'linear-gradient(180deg, #16162a 0%, #111120 100%)',
      },
      animation: {
        'fade-in':    'fadeIn 0.2s ease-out',
        'fade-up':    'fadeUp 0.3s ease-out',
        'slide-in-r': 'slideInRight 0.25s ease-out',
        'slide-in-l': 'slideInLeft 0.25s ease-out',
        'scale-in':   'scaleIn 0.15s ease-out',
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        'shimmer':    'shimmer 1.5s infinite',
      },
      keyframes: {
        fadeIn:       { from: { opacity: '0' }, to: { opacity: '1' } },
        fadeUp:       { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        slideInRight: { from: { transform: 'translateX(100%)' }, to: { transform: 'translateX(0)' } },
        slideInLeft:  { from: { transform: 'translateX(-100%)' }, to: { transform: 'translateX(0)' } },
        scaleIn:      { from: { transform: 'scale(0.95)', opacity: '0' }, to: { transform: 'scale(1)', opacity: '1' } },
        shimmer:      { '0%': { transform: 'translateX(-100%)' }, '100%': { transform: 'translateX(100%)' } },
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [],
};

export default config;
