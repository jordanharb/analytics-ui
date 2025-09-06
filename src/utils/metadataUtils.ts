/**
 * Utility functions for handling dynamic metadata fields
 */

// Fields to always exclude from display
const EXCLUDED_FIELDS = ['should_scrape'];

// Base fields in preferred order
const BASE_FIELD_ORDER = ['actor_type', 'city', 'state', 'region', 'about'];

/**
 * Convert field name to human-readable label
 * e.g., "actor_type" -> "Actor Type", "school_type" -> "School Type"
 */
export function formatFieldLabel(fieldName: string): string {
  // Handle special cases
  const specialCases: Record<string, string> = {
    'actor_type': 'Type',
    'about': 'About',
    'city': 'City', 
    'state': 'State',
    'region': 'Region',
    'school_type': 'School Type',
    'active': 'Active',
    'patriot_point_total': 'Patriot Points',
    'active_members': 'Active Members',
    'founded_year': 'Founded'
  };
  
  if (specialCases[fieldName]) {
    return specialCases[fieldName];
  }
  
  // Convert snake_case to Title Case
  return fieldName
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Format field value for display
 */
export function formatFieldValue(value: any): string {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  
  if (typeof value === 'number') {
    // Check if it's likely a year
    if (value > 1900 && value < 2100 && Number.isInteger(value)) {
      return value.toString();
    }
    // Otherwise format with commas
    return value.toLocaleString();
  }
  
  return String(value);
}

/**
 * Get ordered metadata fields for display
 * Filters out empty values and excluded fields
 */
export function getOrderedMetadataFields(
  metadata: Record<string, any> | undefined,
  customFieldOrder?: string[]
): Array<{ key: string; label: string; value: string }> {
  if (!metadata) return [];
  
  // Filter out excluded fields and empty values
  const validFields = Object.entries(metadata).filter(([key, value]) => {
    if (EXCLUDED_FIELDS.includes(key)) return false;
    if (value === null || value === undefined || value === '') return false;
    return true;
  });
  
  // Create a map for easy lookup
  const fieldMap = new Map(validFields);
  
  // Build ordered list
  const orderedFields: Array<{ key: string; label: string; value: string }> = [];
  
  // First add base fields in order
  BASE_FIELD_ORDER.forEach(key => {
    if (fieldMap.has(key)) {
      const value = formatFieldValue(fieldMap.get(key));
      if (value) {
        orderedFields.push({
          key,
          label: formatFieldLabel(key),
          value
        });
        fieldMap.delete(key); // Remove so we don't add it twice
      }
    }
  });
  
  // Then add custom fields if provided
  if (customFieldOrder) {
    customFieldOrder.forEach(key => {
      if (fieldMap.has(key)) {
        const value = formatFieldValue(fieldMap.get(key));
        if (value) {
          orderedFields.push({
            key,
            label: formatFieldLabel(key),
            value
          });
          fieldMap.delete(key);
        }
      }
    });
  }
  
  // Finally add any remaining fields not in the ordered lists
  fieldMap.forEach((rawValue, key) => {
    const value = formatFieldValue(rawValue);
    if (value) {
      orderedFields.push({
        key,
        label: formatFieldLabel(key),
        value
      });
    }
  });
  
  return orderedFields;
}

/**
 * Check if a field should be displayed prominently in the header
 */
export function isHeaderField(fieldName: string): boolean {
  return ['actor_type', 'city', 'state', 'region'].includes(fieldName);
}