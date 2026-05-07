import type { Config } from 'tailwindcss';

/**
 * Editorial Intimacy palette.
 *
 * Inspired by Apartamento, Aesop, Cereal magazine — the feel of a beautifully
 * printed correspondence. Parchment background, ink type, terracotta as the
 * warmest accent, sage as a quiet companion, wax-seal wine for status,
 * warm gold and dusty rose for accents.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Display: Instrument Serif. Modern transitional serif —
        // upright by default, italic as a deliberate accent. Replaces
        // Fraunces, which leaned too ornamental ("witchy") with the
        // SOFT axis maxed out everywhere.
        display: ['"Instrument Serif"', 'ui-serif', 'Georgia', 'serif'],
        sans: ['"DM Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"DM Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        // Background paper tones
        parchment: '#FAF6EF',
        cream: '#FFFCF6',
        ink: {
          DEFAULT: '#1B1814',
          50: '#F5F2EC',
          100: '#E5DFD5',
          200: '#C4BCAE',
          300: '#9A9081',
          400: '#6F6657',
          500: '#473F33',
          600: '#322B22',
          700: '#22201B',
          800: '#1B1814',
          900: '#0F0E0B',
        },
        // Deepened terracotta (more print-saturated than the previous #E07A5F)
        terracotta: {
          50: '#FBEDE6',
          100: '#F4D3C5',
          200: '#EAA992',
          300: '#DC8666',
          400: '#CD6B49',
          500: '#C25B3F', // brand
          600: '#A24930',
          700: '#7B3624',
          800: '#54251A',
          900: '#321610',
        },
        sage: {
          50: '#EEF3EE',
          100: '#D9E4DC',
          200: '#B6CABE',
          300: '#9AB6A2',
          400: '#7A9A85', // brand
          500: '#5F806C',
          600: '#476454',
          700: '#34493E',
          800: '#22302A',
          900: '#141C19',
        },
        // Wax-seal wine
        wine: {
          50: '#F4E5E3',
          100: '#E5C2BD',
          200: '#CC8E86',
          300: '#B66159',
          400: '#974039',
          500: '#7B2D26', // brand
          600: '#62221C',
          700: '#481814',
          800: '#2D0F0C',
          900: '#190706',
        },
        // Warm gold (printed ochre)
        gold: {
          50: '#FAF1DE',
          100: '#F2DEB7',
          200: '#E8C588',
          300: '#DEAE5E',
          400: '#D4AF6F', // brand
          500: '#B68B47',
          600: '#8E6A33',
          700: '#664B22',
          800: '#3F2E13',
          900: '#23190A',
        },
        // Dusty rose (almost-pink)
        rose: {
          50: '#F8EAEC',
          100: '#EFCED2',
          200: '#DFA1A8',
          300: '#D1858E',
          400: '#C77F87', // brand
          500: '#A2616A',
          600: '#7C474F',
          700: '#552F35',
          800: '#321B1F',
          900: '#1A0D0F',
        },
        // Stone — kept for compatibility but tones reweighted toward parchment
        stone: {
          50: '#FAF6EF',
          100: '#F1ECE0',
          150: '#E9E2D2',
          200: '#DDD3BF',
          300: '#C2B7A0',
          400: '#9A8F77',
          500: '#776E59',
          600: '#5A5341',
          700: '#3D372B',
          800: '#1B1814',
          900: '#0F0E0B',
        },
      },
      fontSize: {
        // Editorial scale — tuned for generous leading
        '7xl': ['4.5rem', { lineHeight: '1.02', letterSpacing: '-0.025em' }],
        '6xl': ['3.75rem', { lineHeight: '1.05', letterSpacing: '-0.02em' }],
        '5xl': ['3rem', { lineHeight: '1.08', letterSpacing: '-0.018em' }],
        '4xl': ['2.25rem', { lineHeight: '1.12', letterSpacing: '-0.012em' }],
      },
      borderRadius: {
        '4xl': '2rem',
      },
      boxShadow: {
        // Soft warm-paper shadows — feel like ink on cream, not material elevation
        paper:
          '0 1px 0 rgba(60, 47, 36, 0.04), 0 8px 22px -12px rgba(60, 47, 36, 0.10)',
        letter:
          '0 1px 1px rgba(60, 47, 36, 0.05), 0 2px 4px rgba(60, 47, 36, 0.04), 0 14px 28px -16px rgba(60, 47, 36, 0.12)',
        soft: '0 1px 2px rgba(60, 47, 36, 0.04), 0 4px 16px rgba(60, 47, 36, 0.06)',
        warm: '0 4px 22px rgba(194, 91, 63, 0.18)',
        seal: '0 0 0 1px rgba(123, 45, 38, 0.18), 0 4px 14px -4px rgba(123, 45, 38, 0.35)',
      },
      keyframes: {
        'slide-up': {
          '0%': { transform: 'translateY(100%)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'scale-in': {
          '0%': { transform: 'scale(0.96)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        'lift-in': {
          '0%': { transform: 'translateY(8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
      animation: {
        'slide-up': 'slide-up 280ms cubic-bezier(0.32, 0.72, 0, 1)',
        'fade-in': 'fade-in 240ms ease-out',
        'scale-in': 'scale-in 220ms cubic-bezier(0.32, 0.72, 0, 1)',
        'lift-in': 'lift-in 280ms cubic-bezier(0.32, 0.72, 0, 1)',
      },
    },
  },
  plugins: [],
} satisfies Config;
