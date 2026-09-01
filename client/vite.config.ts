// @ts-nocheck
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ["@xyflow/react", "react", "react-dom", "react-router-dom"],
  },
  build: {
    rollupOptions: {
      // @ts-ignore
      output: {
        manualChunks(id: string) {
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom") || id.includes("node_modules/react-router")) return "vendor";
          if (id.includes("node_modules/@xyflow")) return "xyflow";
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    proxy: {
      // API_TARGET позволяет поднять вторую пару серверов на копии базы, не
      // трогая рабочую: проверять массовые правки справочника на живой базе
      // владельца нельзя.
      '/api': process.env.API_TARGET || 'http://127.0.0.1:3001',
      '/files': process.env.API_TARGET || 'http://127.0.0.1:3001',
      // RealtimeListener connects io(window.location.origin) — in dev that's
      // the Vite server (5173), not the API server, so the WebSocket upgrade
      // needs its own proxy entry (unlike /api's plain HTTP proxying above).
      // No-op in production, where client and API already share one origin.
      '/socket.io': { target: process.env.API_TARGET || 'http://127.0.0.1:3001', ws: true },
    },
  },
})
