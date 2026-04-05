/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: 'var(--bg-color)',
        surface: 'var(--panel-bg)',
        bordercolor: 'var(--border-color)',
        textcolor: 'var(--text-color)',
      },
      animation: {},
      keyframes: {}
    },
  },
  plugins: [],
}
