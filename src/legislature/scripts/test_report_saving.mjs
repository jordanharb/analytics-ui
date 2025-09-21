import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(dirname(__dirname), '.env.local') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkLatestReports() {
  try {
    // Get the 3 most recent reports
    const { data: reports, error } = await supabase
      .from('rs_analysis_reports')
      .select('report_id, person_id, session_id, bill_ids, donation_ids, created_at')
      .order('created_at', { ascending: false })
      .limit(3);

    if (error) {
      console.error('Error fetching reports:', error);
      return;
    }

    if (!reports || reports.length === 0) {
      console.log('No reports found in the database');
      return;
    }

    console.log('\n=== Latest Reports in Database ===\n');
    
    reports.forEach((report, index) => {
      console.log(`Report #${index + 1} (ID: ${report.report_id})`);
      console.log(`  Created: ${new Date(report.created_at).toLocaleString()}`);
      console.log(`  Person ID: ${report.person_id}`);
      console.log(`  Session ID: ${report.session_id}`);
      
      // Check bill_ids
      if (report.bill_ids && report.bill_ids.length > 0) {
        console.log(`  Bill IDs: [${report.bill_ids.join(', ')}]`);
      } else {
        console.log('  Bill IDs: [] (EMPTY - needs fixing)');
      }
      
      // Check donation_ids
      if (report.donation_ids && report.donation_ids.length > 0) {
        // Check if they're numeric only
        const hasNonNumeric = report.donation_ids.some(id => !/^\d+$/.test(id));
        if (hasNonNumeric) {
          console.log(`  Donation IDs: [${report.donation_ids.slice(0, 3).join(', ')}...] (${report.donation_ids.length} total)`);
          console.log('    WARNING: Contains non-numeric IDs - needs fixing');
        } else {
          console.log(`  Donation IDs: [${report.donation_ids.slice(0, 3).join(', ')}...] (${report.donation_ids.length} total)`);
          console.log('    ✓ All IDs are numeric');
        }
      } else {
        console.log('  Donation IDs: [] (EMPTY)');
      }
      
      console.log('');
    });

    // Get one full report to check the structure
    const { data: fullReport, error: fullError } = await supabase
      .from('rs_analysis_reports')
      .select('report_data')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!fullError && fullReport && fullReport.report_data) {
      console.log('\n=== Checking Latest Report Structure ===\n');
      const reportData = fullReport.report_data;
      
      // Check if phase1_data is included
      if (reportData.phase1_data) {
        console.log('✓ Phase 1 data is included in the report');
        
        // Check for bill IDs in phase1_data
        if (reportData.phase1_data.pairings && reportData.phase1_data.pairings.length > 0) {
          const billIds = new Set();
          reportData.phase1_data.pairings.forEach(pairing => {
            if (pairing.bill_id) {
              billIds.add(pairing.bill_id);
            }
          });
          console.log(`  Found ${billIds.size} unique bill IDs in Phase 1 data: [${Array.from(billIds).slice(0, 5).join(', ')}...]`);
        }
      } else {
        console.log('✗ Phase 1 data is NOT included in the report - this needs to be fixed');
      }
      
      // Check confirmed_connections structure
      if (reportData.confirmed_connections && reportData.confirmed_connections.length > 0) {
        console.log(`\n✓ Report has ${reportData.confirmed_connections.length} confirmed connections`);
        
        // Check a sample connection
        const sampleConn = reportData.confirmed_connections[0];
        if (sampleConn.bill_id) {
          console.log(`  Sample connection has bill_id: ${sampleConn.bill_id}`);
        } else {
          console.log('  Sample connection missing bill_id');
        }
        
        if (sampleConn.donors && sampleConn.donors.length > 0) {
          const sampleDonor = sampleConn.donors[0];
          if (sampleDonor.donation_id) {
            console.log(`  Sample donor has donation_id: "${sampleDonor.donation_id}"`);
            
            // Check format
            if (/^\d+$/.test(sampleDonor.donation_id)) {
              console.log('    Format: Numeric only (correct)');
            } else if (/^\d+/.test(sampleDonor.donation_id)) {
              console.log('    Format: Starts with number but has extra text (needs extraction)');
            } else {
              console.log('    Format: Non-numeric (unexpected)');
            }
          }
        }
      }
    }

  } catch (error) {
    console.error('Error:', error);
  }
}

// Run the check
console.log('Checking report saving in Supabase...');
await checkLatestReports();
console.log('\nDone!');