import { NextRequest, NextResponse } from 'next/server';
import { restCsv } from '@/lib/rest';
import { ERROR_MESSAGES } from '@/lib/constants';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const entityId = searchParams.get('id');

    if (!entityId) {
      return NextResponse.json(
        { error: ERROR_MESSAGES.INVALID_ENTITY_ID },
        { status: 400 }
      );
    }

    // Validate entity ID is a number
    const id = parseInt(entityId, 10);
    if (isNaN(id) || id <= 0) {
      return NextResponse.json(
        { error: ERROR_MESSAGES.INVALID_ENTITY_ID },
        { status: 400 }
      );
    }

    // Build PostgREST query for transactions export view
    // Include all transactions (no limit) ordered by date
    const path = `vw_transactions_export?entity_id=eq.${id}&select=*&order=transaction_date.desc`;
    
    // Fetch CSV data from Supabase
    const response = await restCsv(path);
    
    // Get the raw response body
    const body = await response.arrayBuffer();

    // Return CSV with appropriate headers
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="entity_${id}_transactions_${new Date().toISOString().split('T')[0]}.csv"`,
        'Cache-Control': 'no-cache',
      },
    });

  } catch (error) {
    console.error('Transactions download error:', error);
    
    return NextResponse.json(
      { 
        error: ERROR_MESSAGES.GENERIC,
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}