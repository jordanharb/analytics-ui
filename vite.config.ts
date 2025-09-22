import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Split vendor libraries into separate chunks
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'ui-vendor': ['@tanstack/react-query', 'zustand'],
          'map-vendor': ['mapbox-gl'],
          'ai-vendor': ['@anthropic-ai/sdk', '@google/generative-ai'],
          'supabase-vendor': ['@supabase/supabase-js', '@supabase/ssr'],
          'utils-vendor': ['lodash', 'lodash-es', 'axios']
        }
      }
    },
    chunkSizeWarningLimit: 1000,
    commonjsOptions: {
      include: [/node_modules/]
    }
  },
  optimizeDeps: {
    include: ['@modelcontextprotocol/sdk'],
    exclude: ['@modelcontextprotocol/sdk']
  },
  define: {
    global: 'globalThis',
  },
  server: {
    proxy: {
      // Proxy MCP API requests to the local MCP server during development
      '/api/mcp': {
        target: 'http://localhost:5175',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/mcp/, '/api/mcp')
      }
    }
  }
})