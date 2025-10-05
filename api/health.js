// Health check endpoint for Vercel
export default function handler(req, res) {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: {
      hasSupabaseUrl: !!process.env.VITE_CAMPAIGN_FINANCE_SUPABASE_URL,
      hasApiKey: !!(process.env.VITE_GOOGLE_API_KEY || process.env.VITE_GEMINI_API_KEY)
    }
  });
}