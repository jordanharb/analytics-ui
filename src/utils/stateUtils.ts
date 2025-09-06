// Valid US state codes
const US_STATE_CODES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC' // Include DC as it's often treated as a state
];

// Map of state names to codes
const STATE_NAME_TO_CODE: Record<string, string> = {
  'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
  'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
  'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
  'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS',
  'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
  'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
  'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK',
  'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT',
  'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV',
  'wisconsin': 'WI', 'wyoming': 'WY', 'district of columbia': 'DC',
  'washington dc': 'DC', 'washington d.c.': 'DC'
};

/**
 * Normalize a state string to its 2-letter code
 * Returns null if not a valid US state
 */
export function normalizeState(state: string | null | undefined): string | null {
  if (!state) return null;
  
  const trimmed = state.trim();
  if (!trimmed) return null;
  
  // Check if it's already a valid state code
  const upperCode = trimmed.toUpperCase();
  if (US_STATE_CODES.includes(upperCode)) {
    return upperCode;
  }
  
  // Try to match state name
  const lowerName = trimmed.toLowerCase();
  if (STATE_NAME_TO_CODE[lowerName]) {
    return STATE_NAME_TO_CODE[lowerName];
  }
  
  // Not a valid state
  return null;
}

/**
 * Get unique valid states from a list of state entries
 * Handles duplicates like "AZ" and "Arizona" as the same state
 */
export function getUniqueValidStates(states: Array<{ state: string; count: number }>): {
  uniqueStates: Set<string>;
  validCount: number;
  statesByCode: Map<string, number>;
} {
  const uniqueStates = new Set<string>();
  const statesByCode = new Map<string, number>();
  
  for (const entry of states) {
    const normalized = normalizeState(entry.state);
    if (normalized) {
      uniqueStates.add(normalized);
      // Aggregate counts for the same state
      const currentCount = statesByCode.get(normalized) || 0;
      statesByCode.set(normalized, currentCount + entry.count);
    }
  }
  
  return {
    uniqueStates,
    validCount: uniqueStates.size,
    statesByCode
  };
}

/**
 * Check if a string represents a valid US state
 */
export function isValidState(state: string | null | undefined): boolean {
  return normalizeState(state) !== null;
}