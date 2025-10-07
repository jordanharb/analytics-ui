import { createClient } from '@supabase/supabase-js';

// Use campaign finance specific credentials
const supabaseUrl = import.meta.env.VITE_CAMPAIGN_FINANCE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_CAMPAIGN_FINANCE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Avoid throwing to keep UI functional; consuming modules should handle failures gracefully
  console.warn('Campaign finance Supabase credentials missing. Ensure VITE_CAMPAIGN_FINANCE_SUPABASE_URL and VITE_CAMPAIGN_FINANCE_SUPABASE_ANON_KEY are set.');
}

export const supabase2 = createClient(
  supabaseUrl || 'https://invalid.local',
  supabaseAnonKey || 'anon-placeholder'
);
