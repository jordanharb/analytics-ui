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
    const data = await supabaseRpc('get_entity_transactions', {
      p_entity_id: parseInt(params.id),
      p_limit: limit,
      p_offset: offset
    });

    // Map the response with the new column names
    const mappedData = data.map((row: any) => ({
      transaction_id: row.out_transaction_id,
      transaction_date: row.out_transaction_date,
      amount: row.out_amount,
      transaction_type: row.out_transaction_type,
      transaction_type_disposition_id: row.out_transaction_type_disposition_id,
      contributor_name: row.out_contributor_name,
      vendor_name: row.out_vendor_name,
      occupation: row.out_occupation,
      employer: row.out_employer,
      city: row.out_city,
      state: row.out_state,
      zip_code: row.out_zip_code,
      memo: row.out_memo,
      total_count: row.out_total_count
    }));

    if (format === 'csv') {
      return NextResponse.json(mappedData);
    } else {
      return NextResponse.json(mappedData);
    }
  } catch (error) {
    console.error('Transactions API Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch transactions' },
      { status: 500 }
    );
  }
}