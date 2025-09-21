import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';

// Store conversation sessions in memory (for local use)
// In production, use Redis or database
const sessions = new Map<string, any>();

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const { sessionId, legislatorName, message, isInitial } = await request.json();
    
    // Path to the Gemini API script
    const scriptPath = path.join(process.cwd(), 'scripts', 'gemini_chat_api_exact.mjs');
    
    // Get session data if exists
    const sessionData = sessions.get(sessionId);
    
    return new Promise<Response>((resolve) => {
      let output = '';
      let errorOutput = '';
      
      // Prepare environment variables for the script
      const env = {
        ...process.env,
        LEGISLATOR_NAME: legislatorName,
        IS_INITIAL: isInitial ? 'true' : 'false',
        USER_MESSAGE: message || '',
        SESSION_ID: sessionId,
        SESSION_DATA: sessionData ? JSON.stringify(sessionData) : ''
      };
      
      // Spawn the Gemini script with command line arguments
      const args = [
        scriptPath,
        legislatorName || '',
        isInitial ? 'true' : 'false',
        message || '',
        sessionId || '',
        sessionData?.messages ? JSON.stringify(sessionData.messages) : '[]'
      ];
      const child = spawn('node', args, { env });
      
      child.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      child.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      child.on('close', (code) => {
        if (code !== 0) {
          console.error('Script error:', errorOutput);
          resolve(NextResponse.json(
            { error: 'Failed to generate report', details: errorOutput },
            { status: 500 }
          ));
          return;
        }
        
        try {
          // Parse the JSON output from the script
          const result = JSON.parse(output);
          
          if (result.error) {
            resolve(NextResponse.json(
              { error: result.error },
              { status: 500 }
            ));
            return;
          }
          
          // Store session data for follow-up messages
          if (result.messages) {
            sessions.set(sessionId, {
              messages: result.messages,
              metadata: result.metadata
            });
          }
          
          resolve(NextResponse.json({
            response: result.response,
            stats: result.stats,
            sessionId: sessionId
          }));
        } catch (parseError) {
          console.error('Failed to parse script output:', output);
          resolve(NextResponse.json(
            { error: 'Failed to parse report data' },
            { status: 500 }
          ));
        }
      });
      
      // Set timeout for long-running processes
      setTimeout(() => {
        if (child.killed === false) {
          child.kill();
          resolve(NextResponse.json(
            { error: 'Report generation timed out after 5 minutes' },
            { status: 504 }
          ));
        }
      }, 5 * 60 * 1000);
    });
    
  } catch (error) {
    console.error('Chat error:', error);
    return NextResponse.json(
      { error: 'Failed to process chat request' },
      { status: 500 }
    );
  }
}