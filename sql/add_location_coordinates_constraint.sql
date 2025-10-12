-- Add unique constraint to location_coordinates table for efficient upserts

-- Drop existing constraint if it exists (in case we're re-running)
ALTER TABLE location_coordinates
DROP CONSTRAINT IF EXISTS location_coordinates_city_state_key;

-- Add unique constraint on (city, state) composite key
-- This allows for efficient ON CONFLICT upserts
ALTER TABLE location_coordinates
ADD CONSTRAINT location_coordinates_city_state_key
UNIQUE (city, state);

-- Add index for faster lookups (if not already exists)
CREATE INDEX IF NOT EXISTS idx_location_coordinates_state
ON location_coordinates(state);

CREATE INDEX IF NOT EXISTS idx_location_coordinates_city_state
ON location_coordinates(city, state);

COMMENT ON CONSTRAINT location_coordinates_city_state_key ON location_coordinates IS
'Unique constraint for city/state pairs to enable efficient upserts and prevent duplicates';
