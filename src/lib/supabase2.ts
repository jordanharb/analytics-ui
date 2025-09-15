import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE2_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE2_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Second Supabase project credentials not configured. Please update .env file.');
}

export const supabase2 = createClient(
  supabaseUrl || '',
  supabaseAnonKey || ''
);