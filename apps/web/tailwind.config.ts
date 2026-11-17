import type { Config } from 'tailwindcss';
import plugin from 'tailwindcss/plugin';
import colors from 'tailwindcss/colors';

/**
 * Theme architecture
 * ------------------
 * - `slate` is a static neutral scale ("ink"). Use it together with `dark:` variants,
 *   or for surfaces that stay dark in both themes (hero panel, login artwork).
 * - `gray` is the same scale, but driven by CSS variables that invert in dark mode
 *   (see globals.css). Anything written with gray-* utilities themes itself.
 * - `blue` is the brand accent (cobalt). It is the only accent in the product.
 * - Light tints of status colours (red-50, amber-100, ...) get a dark-mode fallback
 *   from the plugin below, so badges and alerts never glow on a dark surface.
 */

const SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'] as const;

const ink: Record<string, string> = {
  50: '#f6f7f9',
  100: '#eef0f3',
  200: '#dfe3e8',
  300: '#c7cdd5',
  400: '#959ea9',
  500: '#687280',
  600: '#4a5360',
  700: '#363e49',
  800: '#20262e',
  900: '#13171c',
  950: '#0a0d10',
};

const brand: Record<string, string> = {
  50: '#eef3ff',
  100: '#dae5ff',
  200: '#bccfff',
  300: '#8fafff',
  400: '#5c85fb',
  500: '#3964f3',
  600: '#2248e2',
  700: '#1b39c4',
  800: '#1c329c',
  900: '#1c2e7a',
  950: '#121c4b',
};

const themedGray = Object.fromEntries(
  SHADES.map((shade) => [shade, `rgb(var(--gray-${shade}) / <alpha-value>)`]),
);

function hexToChannels(hex: string) {
  const int = parseInt(hex.replace('#', ''), 16);
  return `${(int >> 16) & 255} ${(int >> 8) & 255} ${int & 255}`;
}

const statusFamilies: Record<string, Record<string, string>> = {
  blue: brand,
  red: colors.red,
  rose: colors.rose,
  orange: colors.orange,
  amber: colors.amber,
  yellow: colors.yellow,
  green: colors.green,
  emerald: colors.emerald,
  cyan: colors.cyan,
  sky: colors.sky,
  indigo: colors.indigo,
  violet: colors.violet,
  purple: colors.purple,
  fuchsia: colors.fuchsia,
};

const darkStatusFallbacks = plugin(({ addBase }) => {
  const rules: Record<string, Record<string, string>> = {};
  const both = (cls: string) => `.dark .${cls}, .dark .hover\\:${cls}:hover`;

  for (const [name, scale] of Object.entries(statusFamilies)) {
    const mid = hexToChannels(scale[500]);
    const fills: Array<[string, number]> = [['50', 0.1], ['100', 0.16], ['200', 0.24]];
    for (const [shade, alpha] of fills) {
      rules[both(`bg-${name}-${shade}`)] = { backgroundColor: `rgb(${mid} / ${alpha})` };
    }
    for (const shade of ['100', '200', '300']) {
      rules[both(`border-${name}-${shade}`)] = { borderColor: `rgb(${mid} / 0.32)` };
    }
    const text: Array<[string, string]> = [['600', '400'], ['700', '300'], ['800', '200'], ['900', '100']];
    for (const [from, to] of text) {
      rules[both(`text-${name}-${from}`)] = { color: scale[to] };
    }
  }

  addBase(rules);
});

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
        background: 'rgb(var(--background) / <alpha-value>)',
        foreground: 'rgb(var(--foreground) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        gray: themedGray,
        slate: ink,
        blue: brand,
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '6px',
        md: '8px',
        lg: '14px',
        xl: '16px',
        '2xl': '20px',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        DEFAULT: 'var(--shadow)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        xl: 'var(--shadow-xl)',
        '2xl': 'var(--shadow-xl)',
      },
      keyframes: {
        'rise-in': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'grow-x': {
          from: { transform: 'scaleX(0)' },
          to: { transform: 'scaleX(1)' },
        },
      },
      animation: {
        'rise-in': 'rise-in 0.5s cubic-bezier(0.16, 1, 0.3, 1) both',
        'grow-x': 'grow-x 0.8s cubic-bezier(0.16, 1, 0.3, 1) both',
      },
    },
  },
  plugins: [darkStatusFallbacks],
};
export default config;
