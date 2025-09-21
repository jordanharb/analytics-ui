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
  { params }: { params: { id: string } }
) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
    const format = searchParams.get('format'); // 'csv' for download
    
    // Use the fixed function name
    const data = await supabaseRpc('get_entity_donations', {
      p_entity_id: parseInt(params.id),
      p_limit: limit,
      p_offset: offset
    });

    // Map the response with the new column names
    const mappedData = data.map((row: any) => ({
      donation_id: row.out_donation_id,
      report_id: row.out_report_id,
      report_name: row.out_report_name,
      filing_date: row.out_filing_date,
      donation_date: row.out_donation_date,
      amount: row.out_amount,
      donor_name: row.out_donor_name,
      donor_type: row.out_donor_type,
      occupation: row.out_occupation,
      employer: row.out_employer,
      address: row.out_address,
      city: row.out_city,
      state: row.out_state,
      zip: row.out_zip,
      is_pac: row.out_is_pac,
      is_corporate: row.out_is_corporate,
      total_count: row.out_total_count
    }));

    if (format === 'csv') {
      return NextResponse.json(mappedData);
    } else {
      return NextResponse.json(mappedData);
    }
  } catch (error) {
    console.error('Donations API Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch donations' },
      { status: 500 }
    );
  }
}