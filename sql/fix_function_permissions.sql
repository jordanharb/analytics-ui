-- Fix permissions for search functions
-- Run this in the campaign finance database to ensure functions are accessible

-- Grant execute permissions to anon role for search functions
GRANT EXECUTE ON FUNCTION search_people_with_sessions(text) TO anon;
GRANT EXECUTE ON FUNCTION search_legislators_with_sessions(text) TO anon;
GRANT EXECUTE ON FUNCTION rs_legislators_people_index(text, integer, integer) TO anon;
GRANT EXECUTE ON FUNCTION rs_search_people(text, integer) TO anon;

-- Also grant to authenticated role
GRANT EXECUTE ON FUNCTION search_people_with_sessions(text) TO authenticated;
GRANT EXECUTE ON FUNCTION search_legislators_with_sessions(text) TO authenticated;
GRANT EXECUTE ON FUNCTION rs_legislators_people_index(text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION rs_search_people(text, integer) TO authenticated;

-- Refresh the schema cache to ensure functions are visible
NOTIFY pgrst, 'reload schema';
