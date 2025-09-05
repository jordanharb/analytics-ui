// Puppeteer script to check browser console for errors
const puppeteer = require('puppeteer');

async function checkConsole() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  
  const errors = [];
  const warnings = [];
  const logs = [];
  
  // Listen to console events
  page.on('console', msg => {
    const type = msg.type();
    const text = msg.text();
    
    if (type === 'error') {
      errors.push(text);
      console.log('❌ ERROR:', text);
    } else if (type === 'warning') {
      warnings.push(text);
      console.log('⚠️  WARNING:', text);
    } else if (type === 'log') {
      logs.push(text);
      console.log('📝 LOG:', text);
    }
  });
  
  // Listen to page errors
  page.on('pageerror', error => {
    errors.push(error.message);
    console.log('❌ PAGE ERROR:', error.message);
  });
  
  // Listen to request failures
  page.on('requestfailed', request => {
    errors.push(`Request failed: ${request.url()} - ${request.failure().errorText}`);
    console.log('❌ REQUEST FAILED:', request.url());
  });
  
  try {
    console.log('🔍 Checking http://localhost:5173...\n');
    
    // Navigate to the page
    await page.goto('http://localhost:5173', { 
      waitUntil: 'networkidle2',
      timeout: 10000 
    });
    
    // Wait a bit for any async errors
    await page.waitForTimeout(2000);
    
    console.log('\n📊 Summary:');
    console.log('═══════════');
    console.log(`Errors: ${errors.length}`);
    console.log(`Warnings: ${warnings.length}`);
    console.log(`Logs: ${logs.length}`);
    
    if (errors.length === 0) {
      console.log('\n✅ No errors found in browser console!');
    } else {
      console.log('\n❌ Found errors that need fixing');
    }
    
  } catch (error) {
    console.error('Failed to check page:', error.message);
  } finally {
    await browser.close();
  }
}

checkConsole();