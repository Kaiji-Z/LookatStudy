import type { Config } from "tailwindcss";

export default {
  content: ["./src/renderer/**/*.{ts,tsx,html}", "./index.html"],
  // 深色优先；多邻国式学习产品的现代观感
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // 多邻国风格的活力色 + 深色底
        brand: {
          DEFAULT: "#58cc02", // 多邻国绿
          dark: "#46a302",
          light: "#7ed957",
        },
        accent: {
          DEFAULT: "#1cb0f6", // 多邻国蓝
          dark: "#0a8cdc",
        },
        warning: "#ff4b4b",
        gold: "#ffc800",
      },
      fontFamily: {
        sans: ['"DIN Round"', "system-ui", "-apple-system", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
