import { NextResponse } from 'next/server';

const SUPABASE_URL = process.env.SUPABASE_URL ;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ;

async function supabaseRequest(endpoint: string, params?: any) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${endpoint}`);
  
  if (params) {
    Object.keys(params).forEach(key => 
      url.searchParams.append(key, params[key])
    );
  }
  
  const response = await fetch(url.toString(), {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    }
  });
  
  if (!response.ok) {
    throw new Error(`Supabase request failed: ${response.status}`);
  }
  
  return response.json();
}

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
    throw new Error(`RPC call failed: ${response.status}`);
  }
  
  return response.json();
}

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const entityId = params.id;

    // Fetch entity details using the new function
    const entityDetails = await supabaseRpc('get_entity_details', {
      p_entity_id: parseInt(entityId)
    });

    if (!entityDetails || entityDetails.length === 0) {
      return NextResponse.json({ error: 'Entity not found' }, { status: 404 });
    }

    const entity = entityDetails[0];

    // Fetch financial summary using the new function
    let financialSummary = null;
    try {
      financialSummary = await supabaseRpc('get_entity_financial_summary', {
        p_entity_id: parseInt(entityId)
      });
    } catch (error) {
      console.error('Error fetching financial summary:', error);
    }

    // Fetch summary stats using the new function
    let stats = null;
    try {
      stats = await supabaseRpc('get_entity_summary_stats', {
        p_entity_id: parseInt(entityId)
      });
    } catch (error) {
      console.error('Error fetching summary stats:', error);
    }

    // Fetch reports using the new function
    let reports = [];
    try {
      reports = await supabaseRpc('get_entity_reports', {
        p_entity_id: parseInt(entityId)
      });
    } catch (error) {
      console.error('Error fetching reports:', error);
    }
    
    // Map the financial summary with the new column names
    const mappedFinancialSummary = financialSummary?.[0] ? {
      total_raised: financialSummary[0].out_total_raised,
      total_spent: financialSummary[0].out_total_spent,
      net_amount: financialSummary[0].out_net_amount,
      transaction_count: financialSummary[0].out_transaction_count,
      donation_count: financialSummary[0].out_donation_count,
      expense_count: financialSummary[0].out_expense_count,
      earliest_transaction: financialSummary[0].out_earliest_transaction,
      latest_transaction: financialSummary[0].out_latest_transaction,
      largest_donation: financialSummary[0].out_largest_donation,
      largest_expense: financialSummary[0].out_largest_expense
    } : null;

    // Map the summary stats with the new column names
    const mappedStats = stats?.[0] ? {
      transaction_count: stats[0].out_transaction_count,
      total_raised: stats[0].out_total_raised,
      total_spent: stats[0].out_total_spent,
      report_count: stats[0].out_report_count,
      donation_count: stats[0].out_donation_count,
      first_activity: stats[0].out_first_activity,
      last_activity: stats[0].out_last_activity,
      cash_on_hand: stats[0].out_cash_on_hand,
      largest_donation: stats[0].out_largest_donation,
      average_donation: stats[0].out_average_donation
    } : null;

    return NextResponse.json({
      entity,
      primaryRecord: entity,
      financialSummary: mappedFinancialSummary,
      summaryStats: mappedStats,
      reports: reports || []
    });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch entity data' },
      { status: 500 }
    );
  }
}