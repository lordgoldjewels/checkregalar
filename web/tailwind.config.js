/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        maroon: {
          50: "#fbf2f3",
          100: "#f6e1e4",
          400: "#b4485a",
          600: "#7a1530",
          700: "#611026",
          800: "#4a0c1d",
          900: "#360815",
        },
        gold: {
          400: "#e8c76a",
          500: "#d4af37",
          600: "#b8912a",
        },
      },
    },
  },
  plugins: [],
};
