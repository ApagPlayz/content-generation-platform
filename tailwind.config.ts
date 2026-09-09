import type { Config } from 'tailwindcss'

/**
 * "Warm Creator" theme wiring (issue #126).
 *
 * The palette itself lives in src/app/globals.css as CSS custom properties.
 * This file only points Tailwind's colour names at those variables — no hex
 * values here, and none in the components.
 *
 * The neutral scales the pages already use are remapped PER PROPERTY rather
 * than through `colors`, because the same name means two different things
 * depending on where it is used: `bg-gray-900` is a primary button (accent)
 * while `text-gray-900` is a heading (foreground). Doing it this way reskins
 * every existing page without editing a single className.
 */

const SURFACE = 'var(--surface)'
const SURFACE_2 = 'var(--surface-2)'
const LINE = 'var(--border)'
const ACCENT = 'var(--accent)'

const config: Config = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      // Semantic names for new code to use directly.
      colors: {
        canvas: 'var(--bg)',
        surface: SURFACE,
        'surface-2': SURFACE_2,
        line: LINE,
        ink: 'var(--text)',
        'ink-soft': 'var(--text-2)',
        muted: 'var(--muted)',
        accent: ACCENT,
        'accent-hover': 'var(--accent-hover)',
        'accent-fg': 'var(--accent-fg)',
        'accent-soft': 'var(--accent-soft)',
      },

      // Page and card backgrounds. gray-900/800 are the app's primary button,
      // so they become the accent rather than a dark neutral.
      backgroundColor: {
        white: SURFACE,
        gray: {
          50: 'var(--bg)',
          100: SURFACE_2,
          200: LINE,
          300: LINE,
          800: 'var(--accent-hover)',
          900: ACCENT,
        },
        slate: {
          50: 'var(--bg)',
          100: SURFACE_2,
          200: LINE,
          800: 'var(--accent-hover)',
          900: ACCENT,
          950: 'var(--bg)',
        },
      },

      // Text hierarchy: heading -> body -> muted -> faint.
      textColor: {
        white: 'var(--accent-fg)',
        gray: {
          300: 'var(--muted-2)',
          400: 'var(--muted-2)',
          500: 'var(--muted)',
          600: 'var(--text-2)',
          700: 'var(--text-2)',
          800: 'var(--text)',
          900: 'var(--text)',
        },
        slate: {
          50: 'var(--text)',
          500: 'var(--muted)',
          600: 'var(--text-2)',
          700: 'var(--text-2)',
          900: 'var(--text)',
        },
      },

      borderColor: {
        white: SURFACE,
        gray: { 50: LINE, 100: LINE, 200: LINE, 300: LINE, 900: ACCENT },
        slate: { 200: LINE, 300: LINE, 900: ACCENT },
      },

      divideColor: {
        gray: { 100: LINE, 200: LINE },
      },

      ringColor: {
        gray: { 900: ACCENT },
        slate: { 900: ACCENT },
      },

      // The soft corners are half the point of this look: `rounded-lg` is what
      // every card and button in the app already uses.
      borderRadius: {
        lg: 'var(--radius)',
      },
    },
  },
  plugins: [],
}

export default config
