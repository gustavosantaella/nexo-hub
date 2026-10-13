/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff',
          100: '#dbe6ff',
          200: '#bed0ff',
          300: '#91b0ff',
          400: '#5c86ff',
          500: '#365ff5',
          600: '#203ee0',
          700: '#1b31b5',
          800: '#1c2d8f',
          900: '#1c2b71',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Segoe UI', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(15 23 42 / 0.06), 0 1px 3px 0 rgb(15 23 42 / 0.10)',
      },
    },
  },
  plugins: [],
};
