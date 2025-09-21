import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const sessionId = searchParams.get('session_id');
    const billNumber = searchParams.get('bill_number');
    const billId = searchParams.get('bill_id');
    const search = searchParams.get('search');
    const limit = parseInt(searchParams.get('limit') || '100');
    const offset = parseInt(searchParams.get('offset') || '0');

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // If requesting specific bill by ID
    if (billId) {
      const { data: bill, error } = await supabase
        .from('bills')
        .select(`
          *,
          bill_sponsors (
            legislator_name,
            sponsor_type
          ),
          bill_votes (
            vote_date,
            body,
            vote_result,
            yeas,
            nays
          )
        `)
        .eq('bill_id', billId)
        .single();

      if (error) throw error;
      return NextResponse.json(bill);
    }

    // If requesting specific bill by number
    if (billNumber) {
      const { data: bill, error } = await supabase
        .from('bills')
        .select(`
          *,
          bill_sponsors (
            legislator_name,
            sponsor_type
          ),
          bill_votes (
            vote_date,
            body,
            vote_result,
            yeas,
            nays
          )
        `)
        .ilike('bill_number', billNumber)
        .order('session_id', { ascending: false })
        .limit(1)
        .single();

      if (error) throw error;
      return NextResponse.json(bill);
    }

    // Build query for bill list
    let query = supabase.from('bills').select(`
      bill_id,
      session_id,
      bill_number,
      short_title,
      description,
      primary_sponsor_name,
      date_introduced,
      final_disposition,
      governor_action
    `, { count: 'exact' });

    if (sessionId) {
      query = query.eq('session_id', sessionId);
    }

    if (search) {
      query = query.or(`bill_number.ilike.%${search}%,short_title.ilike.%${search}%,description.ilike.%${search}%,primary_sponsor_name.ilike.%${search}%`);
    }

    query = query
      .order('date_introduced', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data: bills, error, count } = await query;

    if (error) throw error;

    return NextResponse.json({
      bills: bills || [],
      total: count || 0,
      limit,
      offset
    });

  } catch (error) {
    console.error('Bills API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch bills data' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { billId, action } = body;

    if (!billId || !action) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    const supabase = createClient();

    switch (action) {
      case 'get_votes':
        const { data: votes, error: votesError } = await supabase
          .from('legislator_votes')
          .select(`
            legislator_id,
            legislator_name,
            vote_value
          `)
          .eq('bill_id', billId)
          .order('legislator_name');

        if (votesError) throw votesError;
        return NextResponse.json({ votes: votes || [] });

      case 'get_text':
        const { data: bill, error: billError } = await supabase
          .from('bills')
          .select('bill_text, bill_summary')
          .eq('bill_id', billId)
          .single();

        if (billError) throw billError;
        return NextResponse.json(bill);

      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Bills API error:', error);
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    );
  }
}