export default function handler(req, res) {
  const context = `You have access to two Supabase-backed datasets via MCP tools.

Woke Palantir Dataset (Extremism Monitoring):
- Key tables: v2_events (rallies, protests, meetings), v2_social_media_posts (social posts), v2_actors and v2_actor_links (people/org relationships).
- Use tools prefixed with query/search/analyze/get_actor to explore events, posts, trend analytics, and actor profiles.
- Provide precise dates, locations, and actor names when summarizing results.

Arizona Campaign Finance Dataset:
- Key tables: cf_entities & cf_entity_records (committee rollups), cf_transactions (detailed contributions/expenditures), rs_person_legislators & votes (legislator voting history), rs_person_cf_entities (person ↔ committee links), bills & bill_sponsors.
- Campaign-oriented tools are prefixed with campaign_. They expose entity discovery, transaction summaries, donor aggregates, legislator session mappings, and bill voting details.
- Always clarify whether insights come from financial filings or legislative activity, and cite entity IDs or bill numbers when possible.

General Guidance:
- Choose the toolset that matches the user request before attempting free-form reasoning.
- Keep SQL read-only and rely on existing RPCs only when necessary; otherwise query tables directly with safe filters and limits.
- Respect privacy and legal considerations; do not speculate beyond retrieved data.

Current Date: ${new Date().toISOString()}`;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  return res.status(200).json({ context });
}
