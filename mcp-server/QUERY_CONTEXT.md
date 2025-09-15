# Woke Palantir MCP Server - Query Context & Tag System Guide

## Understanding the Tag System

The Woke Palantir database uses a sophisticated tagging system to categorize events. Understanding this system is crucial for effective querying.

### Tag Structure

1. **Category Tags** - Standard tags stored in the `category_tags` table
   - **Education-related tags**: `Education`, `College`, `High School`, `Homeschool`, `Greek Life Engagement`, `Student Government`
   - **Common event tags**: `Meeting`, `Rally`, `Conference`, `Tabling`, `Recruitment`, `Training`, `Social Event`
   - **Special tags**: `Controversy`, `Lobbying`, `School Board`, `Announcement`

2. **Dynamic Slugs** - Specific entity tags stored in the `dynamic_slugs` table
   - Format: `ParentCategory:SpecificEntity`
   - Examples:
     - `School:AZ_University_of_Arizona`
     - `School:CA_Berkeley_High_School`
     - `Church:Calvary_Chapel_Phoenix`
     - `Conference:TPUSA_AmFest_2024_Phoenix`
     - `BallotMeasure:AZ_Prop139_Abortion_2024`
     - `LobbyingTopic:school_choice`
     - `Election:AZ_Governor_2024`

### Important Tag Usage Patterns

Events in the database often have BOTH category tags AND dynamic slugs. For example, an event at a university might have:
- Category tags: `["Education", "College", "Tabling"]`
- Dynamic slug: `["School:AZ_Arizona_State_University"]`

## Effective Query Strategies

### When asked about "schools" or educational institutions:

1. **DO NOT** just search for a tag called "School" - this doesn't exist as a category tag
2. **INSTEAD**, use a multi-pronged approach:
   - Search for events with tags: `Education`, `College`, `High School`, `Homeschool`
   - Search for events with tags starting with `School:` (these are the dynamic slugs)
   - Search for events with `School Board` tag for school board meetings

### Query Patterns for Common Questions

#### "What schools were involved in events?"
```javascript
// Strategy 1: Get all events with education-related tags
const educationTags = ['Education', 'College', 'High School', 'Homeschool', 'School Board'];
const events = await queryEvents({ tags: educationTags });

// Then extract unique School: tags from the results
const schoolTags = events.flatMap(e => e.tags)
  .filter(tag => tag.startsWith('School:'))
  .unique();
```

#### "What events happened at universities/colleges?"
```javascript
// Search for both the College category tag AND School: dynamic tags
const events = await queryEvents({
  tags: ['College', 'Education']
});
// Then filter or extract School: tags from results
```

#### "List all schools ever involved"
```javascript
// Query the dynamic_slugs table directly
const { data } = await supabase
  .from('dynamic_slugs')
  .select('full_slug')
  .eq('parent_tag', 'School');
```

#### "What controversies happened at schools?"
```javascript
// Combine Controversy tag with education tags
const events = await queryEvents({
  tags: ['Controversy', 'Education'] // This will find events with BOTH tags
});
```

### Understanding Tag Combinations

The event processor (Gemini AI) applies tags following these rules:

1. **Mandatory Combinations**:
   - School events MUST have both an education tag (`College`/`High School`) AND a `School:` slug
   - Church events MUST have both a general tag AND a `Church:` slug
   - Lobbying events MUST have both `Lobbying` tag AND a `LobbyingTopic:` slug

2. **Common Patterns**:
   - University events typically have: `["Education", "College", "School:STATE_UniversityName"]`
   - High school events typically have: `["Education", "High School", "School:STATE_SchoolName"]`
   - School board meetings have: `["School Board", "High School", "Lobbying"]` (sometimes with `School:` slug)

## Available Tools and Their Best Uses

### query_events
- Use OR logic for tags when you want events with ANY of the specified tags
- The system will search for events containing ANY of the provided tags
- Example: `tags: ['Education', 'College', 'High School']` finds events with Education OR College OR High School

### get_filter_options
- Returns all available tags organized by category
- Use this to discover valid tag values
- The `slugs_by_parent` field contains dynamic slugs organized by their parent category

### run_sql_query
- Use for complex queries that can't be done with the standard tools
- Useful for:
  - Extracting unique dynamic slugs from events
  - Joining with the dynamic_slugs table
  - Complex aggregations

### Example SQL Queries

```sql
-- Get all unique School: tags from events in a date range
SELECT DISTINCT jsonb_array_elements_text(category_tags) as tag
FROM v2_events
WHERE event_date BETWEEN '2024-01-01' AND '2024-12-31'
AND jsonb_array_elements_text(category_tags) LIKE 'School:%';

-- Get all schools from dynamic_slugs table
SELECT full_slug, label, description
FROM dynamic_slugs
WHERE parent_tag = 'School'
ORDER BY full_slug;

-- Find events at specific schools
SELECT * FROM v2_events
WHERE category_tags @> '["School:AZ_Arizona_State_University"]'::jsonb;
```

## Best Practices

1. **Always use multiple related tags** when searching for educational events:
   - Don't just search for "School" (it doesn't exist)
   - Use: `['Education', 'College', 'High School']`

2. **Extract and analyze dynamic slugs** from results:
   - After getting events, extract all `School:`, `Church:`, etc. tags
   - These provide specific institution information

3. **Use get_filter_options first** when unsure about available tags:
   - This shows all valid tags and their organization
   - Helps avoid searching for non-existent tags

4. **Combine category and dynamic tags** for precise queries:
   - For ASU events: Look for tags containing both "College" AND "School:AZ_Arizona_State_University"

5. **Remember tag application patterns**:
   - The AI often uses "Education" as a broad category
   - Specific institution tags (School:) are added for location specificity
   - Multiple tags are used to capture different aspects of an event

## Common Pitfalls to Avoid

1. ❌ Searching for "School" as a tag - it doesn't exist
2. ❌ Assuming all education events have School: tags - many just have "Education"
3. ❌ Missing results by being too specific - use broader category tags first
4. ❌ Forgetting that tags are case-sensitive in the database
5. ❌ Not checking for both category tags AND dynamic slugs

## Response Enhancement

When no results are found or results seem incomplete:

1. Suggest broader searches using parent category tags
2. Show available related tags from get_filter_options
3. Explain the tag hierarchy and suggest alternative queries
4. Offer to search the dynamic_slugs table directly for comprehensive lists