import type { Config } from 'tailwindcss'

/**
 * "Warm Creator" theming (issue #126).
 *
 * The palette itself lives in exactly one place — the CSS custom properties at
 * the top of src/app/globals.css. This file only points Tailwind's neutral
 * scales at those variables, by ROLE rather than by lightness:
 *
 *   50/100 -> surface-2   200 -> border   300 -> faint
 *   400/500/600 -> muted  700/800/900/950 -> text
 *
 * Because the variables (not the numbers) flip under `.dark`, every existing
 * `bg-gray-50` / `text-gray-500` / `border-gray-200` call site in the app gets
 * the warm palette in light mode AND the correct inverted colour in dark mode,
 * with no per-component edits and no second copy of the mapping.
 */
const neutral = {
  50: 'var(--surface-2)',
  100: 'var(--surface-2)',
  200: 'var(--border)',
  300: 'var(--faint)',
  400: 'var(--muted)',
  500: 'var(--muted)',
  600: 'var(--muted)',
  700: 'var(--text)',
  800: 'var(--text)',
  900: 'var(--text)',
  950: 'var(--text)',
}

const config: Config = {
  // The header toggle puts `.dark` on <html>; never follow the OS setting,
  // because issue #126 asks for light as the default.
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        gray: neutral,
        slate: neutral,
        stone: neutral,
        // Semantic names for new code, so it never has to guess a number.
        surface: { DEFAULT: 'var(--surface)', 2: 'var(--surface-2)' },
        accent: {
          DEFAULT: 'var(--accent)',
          fg: 'var(--accent-fg)',
          soft: 'var(--accent-soft)',
        },
      },
      borderRadius: {
        // The soft 18px corner is the signature of this look.
        lg: 'var(--radius)',
        token: 'var(--radius)',
      },
    },
  },
  plugins: [],
}

export default config
