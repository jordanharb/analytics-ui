/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Palantir Light Theme Colors - matching palantir-light-theme.css
        'snow': {
          '50': '#FFFFFF',
          '100': '#FAFBFC',
          '150': '#F5F7FA',
          '200': '#EDF0F5',
        },
        'gray': {
          '50': '#f9fafb',
          '100': '#F3F4F6',
          '200': '#E5E7EB',
          '300': '#D1D5DB',
          '400': '#9CA3AF',
          '500': '#6B7280',
          '600': '#4B5563',
          '700': '#374151',
          '800': '#1F2937',
          '900': '#111827',
        },
        // Azure Blue - Primary Accent
        'azure': {
          'primary': '#0066CC',
          'light': '#3384E0',
          'lighter': '#66A3E8',
          'lightest': '#E6F2FF',
          'dark': '#004499',
        },
        // Simplified blue scale for Mapbox clusters
        'blue': {
          '50': '#F0F7FF',
          '100': '#E5F2FF',
          '200': '#DBEAFE',
          '300': '#BFDBFE',
          '400': '#93C5FD',
          '500': '#2563EB',
          '600': '#1D4ED8',
          '700': '#1E40AF',
          '800': '#1E3A8A',
          '900': '#1E3A8A',
        },
        // Semantic Colors
        'success': {
          '100': '#D1FAE5',
          '500': '#059669',
        },
        'warning': {
          '100': '#FEF3C7',
          '500': '#D97706',
        },
        'danger': {
          '100': '#FEE2E2',
          '500': '#DC2626',
          '600': '#B91C1C',
        },
        'info': {
          '100': '#E0F2FE',
          '500': '#0891B2',
        },
        'violet': {
          '100': '#F3E8FF',
          '500': '#7C3AED',
        },
      },
      fontFamily: {
        'display': ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        'sans': ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        'mono': ['SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', 'monospace'],
      },
      fontSize: {
        'xs': '0.75rem',
        'sm': '0.875rem',
        'base': '1rem',
        'lg': '1.125rem',
        'xl': '1.25rem',
        '2xl': '1.5rem',
        '3xl': '1.875rem',
        '4xl': '2.25rem',
      },
      spacing: {
        '18': '4.5rem',
        '88': '22rem',
        '120': '30rem',
      },
      borderRadius: {
        'sm': '0.25rem',
        'md': '0.375rem',
        'lg': '0.5rem',
        'xl': '0.75rem',
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      boxShadow: {
        'xs': '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        'sm': '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
        'md': '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        'lg': '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
        'xl': '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
        '2xl': '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
        'azure': '0 0 0 3px rgba(0, 102, 204, 0.2)',
        'cluster-sm': '0 2px 8px rgba(37, 99, 235, 0.15), 0 1px 3px rgba(37, 99, 235, 0.08)',
        'cluster-md': '0 4px 12px rgba(29, 78, 216, 0.2), 0 2px 4px rgba(29, 78, 216, 0.1)',
        'cluster-lg': '0 6px 16px rgba(30, 64, 175, 0.25), 0 3px 6px rgba(30, 64, 175, 0.12)',
      },
      animation: {
        'spin': 'spin 0.8s linear infinite',
        'pulse': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'slide-in-right': 'slideInRight 0.3s ease-out',
        'shimmer': 'shimmer 1.5s infinite',
      },
      keyframes: {
        fadeIn: {
          'from': { opacity: '0' },
          'to': { opacity: '1' }
        },
        slideUp: {
          'from': { 
            opacity: '0',
            transform: 'translateY(20px)'
          },
          'to': {
            opacity: '1',
            transform: 'translateY(0)'
          }
        },
        slideInRight: {
          'from': {
            opacity: '0',
            transform: 'translateX(20px)'
          },
          'to': {
            opacity: '1',
            transform: 'translateX(0)'
          }
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' }
        }
      },
      transitionDuration: {
        '0': '0ms',
        '150': '150ms',
        '200': '200ms',
        '300': '300ms',
        '500': '500ms',
      },
      transitionTimingFunction: {
        'bounce': 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
      },
      zIndex: {
        '100': '100',
        '200': '200',
        '300': '300',
        '400': '400',
        '500': '500',
        '600': '600',
        '700': '700',
        '800': '800',
        '900': '900',
        '9999': '9999',
      },
    },
  },
  plugins: [],
}