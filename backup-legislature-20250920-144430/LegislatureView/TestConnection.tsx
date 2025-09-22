import React, { useEffect } from 'react';
import { supabase2 } from '../../lib/supabase2';

export const TestConnection: React.FC = () => {
  useEffect(() => {
    const testConnection = async () => {
      console.log('Testing Supabase2 connection...');
      
      // Test 1: Check if we can connect at all
      try {
        const { data, error } = await supabase2
          .from('legislators')
          .select('*')
          .limit(1);
        
        if (error) {
          console.error('Error fetching from legislators table:', error);
        } else {
          console.log('Successfully fetched from legislators:', data);
        }
      } catch (e) {
        console.error('Exception fetching legislators:', e);
      }

      // Test 2: Try RPC function
      try {
        const { data, error } = await supabase2.rpc('rs_search_all', { q: 'test' });
        
        if (error) {
          console.error('Error calling rs_search_all:', error);
        } else {
          console.log('Successfully called rs_search_all:', data);
        }
      } catch (e) {
        console.error('Exception calling rs_search_all:', e);
      }

      // Test 3: Check auth status
      const { data: { session } } = await supabase2.auth.getSession();
      console.log('Auth session:', session);
    };

    testConnection();
  }, []);

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Testing Database Connection</h1>
      <p>Check the browser console for connection test results.</p>
    </div>
  );
};