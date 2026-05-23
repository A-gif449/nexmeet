import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // proxy: {
    //   '/create-room': 'http://localhost:4000',
    //   '/health': 'http://localhost:4000',
    // }
  }
})