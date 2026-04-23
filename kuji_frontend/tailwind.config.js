/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans:  ['"Inter Tight"', 'Inter', '"Noto Sans TC"', 'system-ui', 'sans-serif'],
        mono:  ['ui-monospace', '"JetBrains Mono"', '"SF Mono"', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};
