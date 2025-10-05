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
    exclude: ['@modelcontextprotocol/sdk', '@modelcontextprotocol/sdk/client/index.js', '@modelcontextprotocol/sdk/client/streamableHttp.js']
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
      },
      // Proxy AI SDK API requests to development server
      '/api/ai-sdk-chat': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  }
})
