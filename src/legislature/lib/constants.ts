// Application constants

export const APP_CONFIG = {
  // Search settings
  DEFAULT_SEARCH_LIMIT: 25,
  TRANSACTION_PREVIEW_LIMIT: 50,
  
  // Pagination
  DEFAULT_OFFSET: 0,
  
  // Date formats
  DATE_FORMAT: 'YYYY-MM-DD',
  DISPLAY_DATE_FORMAT: 'MMM DD, YYYY',
  
  // Cache settings
  CACHE_REVALIDATE_SECONDS: 60,
  
  // Export settings
  MAX_ENTITY_IDS: 50, // Reasonable limit for bulk exports
} as const;

export const ERROR_MESSAGES = {
  GENERIC: 'An unexpected error occurred. Please try again.',
  NETWORK: 'Network error. Please check your connection and try again.',
  NOT_FOUND: 'The requested data could not be found.',
  VALIDATION: 'Please check your input and try again.',
  RATE_LIMIT: 'Too many requests. Please wait a moment before trying again.',
  EXPORT_FAILED: 'Export failed. Please try again or contact support.',
  INVALID_ENTITY_ID: 'Invalid entity ID provided.',
  EMPTY_SEARCH: 'Please enter a search term.',
} as const;

export const SUCCESS_MESSAGES = {
  EXPORT_READY: 'Export is ready for download',
  SEARCH_COMPLETE: 'Search completed successfully',
} as const;

// UI Constants
export const UI = {
  COLORS: {
    PRIMARY: '#0066cc',
    SUCCESS: '#16a34a',
    ERROR: '#dc2626',
    WARNING: '#d97706',
    GRAY: '#6b7280',
    LIGHT_GRAY: '#f9f9f9',
    BORDER: '#e5e5e5',
  },
  BREAKPOINTS: {
    SM: '640px',
    MD: '768px',
    LG: '1024px',
    XL: '1280px',
  }
} as const;

// API Endpoints (relative to base URL)
export const API_ENDPOINTS = {
  SEARCH: 'rpc/search_entities',
  ENTITIES: 'cf_entities',
  ENTITY_RECORDS: 'cf_entity_records', 
  REPORTS_EXPORT: 'vw_reports_export',
  TRANSACTIONS_EXPORT: 'vw_transactions_export',
  BULK_EXPORT: 'functions/v1/bulk_export',
} as const;