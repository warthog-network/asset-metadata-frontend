/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{ts,html}",
    "./public/index.html",
    "./public/**/*.html",
  ],
  theme: {
    extend: {
      colors: {
        "brand-yellow": "#FDB913",
        "brand-orange": "#E79300",
        "brand-bg-1": "#111b2e",
        "brand-bg-2": "#020617",
        "brand-bg-3": "#000308",
        "brand-card": "rgba(8, 12, 24, 0.75)",
        "brand-border": "rgba(255, 255, 255, 0.1)",
        "brand-text": "#f8fafc",
        "brand-muted": "rgba(226, 232, 240, 0.75)",
      },
      fontFamily: {
        montserrat: [
          "Montserrat",
          "Inter",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};
