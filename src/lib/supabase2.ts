import { createClient } from '@supabase/supabase-js';

// Use campaign finance specific credentials
const supabaseUrl = import.meta.env.VITE_SUPABASE2_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE2_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Avoid throwing to keep UI functional; consuming modules should handle failures gracefully
  console.warn('Supabase 2 credentials missing. Ensure VITE_SUPABASE2_URL and VITE_SUPABASE2_ANON_KEY are set.');
}

export const supabase2 = createClient(
  supabaseUrl || 'https://invalid.local',
  supabaseAnonKey || 'anon-placeholder'
);
