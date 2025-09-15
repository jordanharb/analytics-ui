import { createClient } from '@supabase/supabase-js';

// Prefer dedicated SECONDARY creds if provided; otherwise fall back to primary ones.
const supabaseUrl = import.meta.env.VITE_SUPABASE2_URL || import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE2_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Avoid throwing to keep UI functional; consuming modules should handle failures gracefully
  console.warn('Supabase credentials missing. Ensure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set.');
}

export const supabase2 = createClient(
  supabaseUrl || 'https://invalid.local',
  supabaseAnonKey || 'anon-placeholder'
);
