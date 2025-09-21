import { NextResponse } from 'next/server';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ffdrtpknppmtkkbqsvek.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmZHJ0cGtucHBtdGtrYnFzdmVrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MTkxMzg3NiwiZXhwIjoyMDY3NDg5ODc2fQ.Vy6VzGOHWbTZNlRg_tZcyP3Y05LFf4g5sHYD6oaRY0s';

async function supabaseRpc(functionName: string, params: any) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(params)
  });
  
  if (!response.ok) {
    const error = await response.text();
    console.error('RPC Error:', error);
    throw new Error(`RPC call failed: ${response.status}`);
  }
  
  return response.json();
}

export async function GET(
  request: Request,
  { params }: { params: { id: string; reportId: string } }
) {
  try {
    // Get donations for a specific report
    const data = await supabaseRpc('get_report_donations_csv', {
      p_report_id: parseInt(params.reportId)
    });
    
    return NextResponse.json(data);
  } catch (error) {
    console.error('Report Donations API Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch report donations' },
      { status: 500 }
    );
  }
}