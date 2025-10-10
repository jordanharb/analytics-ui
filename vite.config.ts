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
    chunkSizeWarningLimit: 2000, // Increased for mapbox-gl (1.6MB)
    commonjsOptions: {
      include: [/node_modules/]
    }
  },
  define: {
    global: 'globalThis',
  },
  server: {
    proxy: {
      // Proxy API requests to Vercel development server when running locally
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        configure: (proxy, _options) => {
          proxy.on('error', (err, _req, _res) => {
            console.log('Proxy error:', err);
          });
          proxy.on('proxyReq', (_proxyReq, req, _res) => {
            console.log('Sending Request to the Target:', req.method, req.url);
          });
          proxy.on('proxyRes', (proxyRes, req, _res) => {
            console.log('Received Response from the Target:', proxyRes.statusCode, req.url);
          });
        },
      }
    }
  }
})
