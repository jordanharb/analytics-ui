import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(request: NextRequest) {
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: sessions, error } = await supabase
      .from('sessions')
      .select('session_id, session_name, legislature_number, session_type, year')
      .order('session_id', { ascending: false })
      .limit(20);

    if (error) {
      console.error('Sessions API error:', error);
      throw error;
    }

    return NextResponse.json(sessions || []);
  } catch (error) {
    console.error('Sessions API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch sessions' },
      { status: 500 }
    );
  }
}