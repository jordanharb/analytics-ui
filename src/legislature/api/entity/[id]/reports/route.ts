import { NextResponse } from 'next/server';

const SUPABASE_URL = process.env.SUPABASE_URL ;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ;

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
    const format = searchParams.get('format'); // 'csv' for download
    
    const entityId = params.id;

    // Fetch reports from cf_reports table directly
    const url = `${SUPABASE_URL}/rest/v1/cf_reports?entity_id=eq.${entityId}&order=rpt_file_date.desc`;

    const response = await fetch(url, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch reports: ${response.status}`);
    }

    const data = await response.json();

    if (format === 'csv') {
      // Return data formatted for CSV export
      return NextResponse.json(data);
    } else {
      // Return regular JSON data
      return NextResponse.json(data);
    }
  } catch (error) {
    console.error('Reports API Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch reports' },
      { status: 500 }
    );
  }
}