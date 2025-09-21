import { NextRequest, NextResponse } from 'next/server';
import { BulkExportRequest, ExportJob } from '@/lib/types';
import { APP_CONFIG, ERROR_MESSAGES } from '@/lib/constants';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Missing required environment variables: SUPABASE_URL, SUPABASE_ANON_KEY');
}

export async function POST(request: NextRequest) {
  try {
    // Parse request body
    const body: BulkExportRequest = await request.json();

    // Validate request
    if (!body.kind || !Array.isArray(body.entity_ids)) {
      return NextResponse.json(
        { error: 'Invalid request: kind and entity_ids are required' },
        { status: 400 }
      );
    }

    if (body.entity_ids.length === 0) {
      return NextResponse.json(
        { error: 'At least one entity ID is required' },
        { status: 400 }
      );
    }

    if (body.entity_ids.length > APP_CONFIG.MAX_ENTITY_IDS) {
      return NextResponse.json(
        { error: `Too many entity IDs. Maximum allowed: ${APP_CONFIG.MAX_ENTITY_IDS}` },
        { status: 400 }
      );
    }

    // Validate all entity IDs are positive integers
    const invalidIds = body.entity_ids.filter(id => 
      typeof id !== 'number' || !Number.isInteger(id) || id <= 0
    );
    
    if (invalidIds.length > 0) {
      return NextResponse.json(
        { error: `Invalid entity IDs: ${invalidIds.join(', ')}` },
        { status: 400 }
      );
    }

    // Call the edge function
    const edgeFunctionUrl = `${SUPABASE_URL}/functions/v1/bulk_export`;
    
    const response = await fetch(edgeFunctionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    // If edge function returned an error
    if (!response.ok) {
      console.error('Edge function error:', data);
      return NextResponse.json(
        { 
          error: data.error || ERROR_MESSAGES.EXPORT_FAILED,
          details: data.details
        },
        { status: response.status }
      );
    }

    // Return successful response
    return NextResponse.json(data as ExportJob, { status: 200 });

  } catch (error) {
    console.error('Bulk export error:', error);
    
    return NextResponse.json(
      { 
        error: ERROR_MESSAGES.GENERIC,
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}