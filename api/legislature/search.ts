import type { VercelRequest, VercelResponse } from '@vercel/node';

const SUPABASE_URL = process.env.VITE_CAMPAIGN_FINANCE_SUPABASE_URL || 'https://ffdrtpknppmtkkbqsvek.supabase.co';
const SERVICE_ROLE_KEY = process.env.CAMPAIGN_FINANCE_SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmZHJ0cGtucHBtdGtrYnFzdmVrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MTkxMzg3NiwiZXhwIjoyMDY3NDg5ODc2fQ.Vy6VzGOHWbTZNlRg_tZcyP3Y05LFf4g5sHYD6oaRY0s';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { q, lim = '25', off = '0' } = req.query;

  if (!q || typeof q !== 'string') {
    return res.status(200).json([]);
  }

  try {
    const url = `${SUPABASE_URL}/rest/v1/rpc/search_entities`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'apikey': SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        q: q.trim(),
        lim: parseInt(lim as string),
        off: parseInt(off as string)
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Search API error: ${response.status}`, errorText);
      throw new Error(`API request failed: ${response.status}`);
    }

    const data = await response.json();
    return res.status(200).json(data || []);
  } catch (error) {
    console.error('Search error:', error);
    return res.status(500).json({ error: 'Search failed' });
  }
}