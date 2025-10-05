// Simple debug endpoint to check what's happening
export default async function handler(req, res) {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    // Check environment variables
    const envCheck = {
      hasSupabaseUrl: !!process.env.VITE_CAMPAIGN_FINANCE_SUPABASE_URL,
      hasSupabaseKey: !!process.env.CAMPAIGN_FINANCE_SUPABASE_SERVICE_KEY,
      hasGoogleKey: !!(process.env.VITE_GOOGLE_API_KEY || process.env.VITE_GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
      hasOpenAIKey: !!(process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY),
      nodeVersion: process.version,
      method: req.method,
      hasBody: !!req.body,
      bodyType: typeof req.body,
      url: req.url
    };

    console.log('Debug info:', envCheck);

    res.status(200).json({
      status: 'debug',
      timestamp: new Date().toISOString(),
      environment: envCheck,
      message: 'Debug endpoint working'
    });

  } catch (error) {
    console.error('Debug endpoint error:', error);
    res.status(500).json({
      error: 'Debug endpoint failed',
      message: error.message,
      stack: error.stack
    });
  }
}