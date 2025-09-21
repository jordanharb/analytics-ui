import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';

export async function POST(request: NextRequest) {
  try {
    const { legislatorName } = await request.json();
    
    if (!legislatorName) {
      return NextResponse.json({ error: 'Legislator name required' }, { status: 400 });
    }

    // Create a unique ID for this report generation
    const reportId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Start the report generation process
    const scriptPath = path.join(process.cwd(), 'scripts', 'gemini_report_final.mjs');
    const child = spawn('node', [scriptPath], {
      cwd: process.cwd(),
      env: process.env
    });

    // Store output
    let output = '';
    let error = '';
    let reportPath = '';

    // Send the legislator name to the script
    child.stdin.write(legislatorName + '\n');
    child.stdin.end();

    // Capture output
    child.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      
      // Check for report path in output
      const pathMatch = text.match(/Full report saved to: (.+\.md)/);
      if (pathMatch) {
        reportPath = pathMatch[1];
      }
    });

    child.stderr.on('data', (data) => {
      error += data.toString();
    });

    // Wait for process to complete
    await new Promise((resolve, reject) => {
      child.on('exit', (code) => {
        if (code === 0) {
          resolve(null);
        } else {
          reject(new Error(`Process exited with code ${code}`));
        }
      });
      
      // Timeout after 30 minutes
      setTimeout(() => {
        child.kill();
        reject(new Error('Report generation timeout'));
      }, 1800000);
    });

    return NextResponse.json({
      success: true,
      reportId,
      reportPath,
      output
    });

  } catch (error) {
    console.error('Report generation error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to generate report', details: errorMessage },
      { status: 500 }
    );
  }
}