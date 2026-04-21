/**
 * @rio.js/ui-next Tailwind v3 Preset
 *
 * Usage in tailwind.config.cjs:
 *   presets: [require("@rio.js/ui-next/tokens/tailwind.v3")]
 */

const steps = [50, 100, 200, 300, 400, 500, 600, 700, 800, 850, 900, 950]
const legacySteps = {
  100: 1,
  200: 2,
  300: 3,
  400: 4,
  500: 5,
  600: 6,
  700: 7,
  800: 8,
  900: 9,
  1000: 10,
  1100: 11,
  1200: 12,
}
const legacyPalettes = { scale: "raw-sage", brand: "raw-teal" }
const palettes = [
  "scale",
  "primary",
  "secondary",
  "destructive",
  "warning",
  "success",
]

const { addDynamicIconSelectors } = require("@iconify/tailwind")

function buildPaletteColors(palette) {
  const colors = {}
  for (const step of steps) {
    colors[step] = `hsl(var(--${palette}-${step}) / <alpha-value>)`
  }
  return colors
}

function buildLegacyPaletteColors(palette) {
  const colors = {}
  for (const step in legacySteps) {
    colors[step] = `hsl(var(--${palette}-${legacySteps[step]}) / <alpha-value>)`
  }
  return colors
}

function buildAllColors() {
  const colors = {}

  for (const palette in legacyPalettes) {
    colors[palette] = buildLegacyPaletteColors(legacyPalettes[palette])
  }

  for (const palette of palettes) {
    colors[palette] = {
      ...(colors[palette] || {}),
      ...buildPaletteColors(palette),
    }
  }

  colors.brand = {
    DEFAULT: "hsl(var(--teal-700) / <alpha-value>)",
    ...colors["brand"],
  }

  // Semantic aliases (shadcn-compatible)
  colors.background = "hsl(var(--background) / <alpha-value>)"
  colors.foreground = "hsl(var(--foreground) / <alpha-value>)"
  colors.muted = {
    DEFAULT: "hsl(var(--muted) / <alpha-value>)",
    foreground: "hsl(var(--muted-foreground) / <alpha-value>)",
  }
  colors.card = {
    DEFAULT: "hsl(var(--card) / <alpha-value>)",
    foreground: "hsl(var(--card-foreground) / <alpha-value>)",
  }
  colors.popover = {
    DEFAULT: "hsl(var(--popover) / <alpha-value>)",
    foreground: "hsl(var(--popover-foreground) / <alpha-value>)",
  }
  colors.border = "hsl(var(--border) / <alpha-value>)"
  colors.input = "hsl(var(--input) / <alpha-value>)"
  colors.ring = "hsl(var(--ring) / <alpha-value>)"
  colors.accent = {
    DEFAULT: "hsl(var(--accent) / <alpha-value>)",
    foreground: "hsl(var(--accent-foreground) / <alpha-value>)",
  }

  console.log(colors)
  return colors
}

/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
    extend: {
      colors: buildAllColors(),
      fontFamily: {
        sans: ["var(--font-sans)"],
        heading: ["var(--font-heading)"],
        mono: ["var(--font-mono)"],
        inter: ["var(--font-inter)"],
        numbers: ["var(--font-numbers)"],
      },
      /* fontWeight: {
        // Quicksand renders thin — shift the entire scale up by 100.
        // If you switch to Inter/system fonts, revert to standard
        // Tailwind weights (thin:100, light:300, normal:400, etc.).
        thin: "200",
        extralight: "300",
        light: "400",
        normal: "500",
        medium: "600",
        semibold: "700",
        bold: "800",
        extrabold: "900",
        black: "900",
      }, */
      fontSize: {
        // md: ["1rem", "1rem"],
        // sm: ["0.75rem", "0.75rem"],
        // xs: ["0.6875rem", "0.6875rem"],
        base: ["0.875rem", "1rem"],
        lg: ["1.15rem", "1.25rem"],
        md: ["1rem", "1.15rem"],
        // base: ["1rem", "1rem"],
        sm: ["0.825rem", "0.85rem"],
        xs: ["0.75rem", "0.75rem"],
        "2xs": ["0.625rem", "0.75rem"],
        // lg: ["0.875rem", "0.875rem"],
        "icon-sm": ["0.75rem", "0"],
        "icon-md": ["1rem", "0"],
        "icon-lg": ["1.125rem", "0"],
        "icon-xl": ["1.5rem", "0"],
        "icon-2xl": ["2rem", "0"],
        "icon-3xl": ["3rem", "0"],
        "icon-4xl": ["4rem", "0"],
        "icon-5xl": ["5rem", "0"],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      zIndex: {
        base: "var(--z-base)",
        sticky: "var(--z-sticky)",
        dropdown: "var(--z-dropdown)",
        popover: "var(--z-popover)",
        modal: "var(--z-modal)",
        toast: "var(--z-toast)",
        tooltip: "var(--z-tooltip)",
      },
      transitionDuration: {
        fast: "var(--duration-fast)",
        normal: "var(--duration-normal)",
        slow: "var(--duration-slow)",
      },
      transitionTimingFunction: {
        default: "var(--ease-default)",
        "ease-in": "var(--ease-in)",
        "ease-out": "var(--ease-out)",
      },
      spacing: {
        unit: "var(--spacing-unit)",
        "unit-2": "calc(var(--spacing-unit) * 2)",
        "unit-3": "calc(var(--spacing-unit) * 3)",
        "unit-4": "calc(var(--spacing-unit) * 4)",
        "unit-5": "calc(var(--spacing-unit) * 5)",
        "unit-6": "calc(var(--spacing-unit) * 6)",
        "unit-8": "calc(var(--spacing-unit) * 8)",
        "unit-10": "calc(var(--spacing-unit) * 10)",
        "unit-12": "calc(var(--spacing-unit) * 12)",
        "unit-16": "calc(var(--spacing-unit) * 16)",
      },
    },
  },
  plugins: [addDynamicIconSelectors()],
}
