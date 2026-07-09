import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    // PORT задаёт превью-обвязка Claude, когда 5173 занят другой сессией.
    port: Number(process.env.PORT) || 5173,
  },
})
