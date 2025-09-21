import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    // Direct database query for legislators
    const response = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/legislators?select=legislator_id,full_name,party,body&order=full_name.asc&limit=500`,
      {
        headers: {
          'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY!,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    if (!response.ok) {
      throw new Error('Failed to fetch legislators');
    }
    
    const data = await response.json();
    return NextResponse.json(data);
    
  } catch (error) {
    console.error('Legislators API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch legislators' },
      { status: 500 }
    );
  }
}