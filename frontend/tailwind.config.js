/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#fcf7ff',
          100: '#f5ebff',
          200: '#edd6ff',
          300: '#deb3fe',
          400: '#c582ff',
          500: '#a855f7',
          600: '#9d50bb', // Custom Neon Purple
          700: '#7e22ce',
          800: '#6b21a8',
          900: '#581c87',
          950: '#0a0a0c', // Deep charcoal
        },
        cyan: {
          400: '#47d6ff',
          500: '#00d2ff', // Custom Neon Cyan
        },
        slate: {
          950: '#0a0a0c', // Deep charcoal background
        }
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      backdropBlur: {
        xs: '2px',
      }
    },
  },
  plugins: [],
}
