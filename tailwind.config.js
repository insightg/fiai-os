/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: '#F5F5F7',
        bg2: '#FFFFFF',
        bg3: '#EEEEF0',
        bg4: '#E4E4E8',
        border: '#D1D1D6',
        border2: '#B8B8C0',
        text: '#1A1A2E',
        text2: '#4A4A5A',
        text3: '#8A8A9A',
        gold: '#C41E3A',
        'gold-l': '#E03050',
        'gold-d': '#8B1428',
        green: '#2D8B56',
        red: '#D32F2F',
        blue: '#1976D2',
        amber: '#E68A00',
        purple: '#7B1FA2',
      },
      fontFamily: {
        display: ['Playfair Display', 'serif'],
        sans: ['DM Sans', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
