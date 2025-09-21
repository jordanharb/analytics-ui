import { NextRequest } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';

export async function POST(request: NextRequest) {
  const { legislatorName } = await request.json();
  
  if (!legislatorName) {
    return new Response('Legislator name required', { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const scriptPath = path.join(process.cwd(), 'scripts', 'gemini_report_final.mjs');
        const child = spawn('node', [scriptPath], {
          cwd: process.cwd(),
          env: process.env
        });

        let reportPath = '';

        // Send the legislator name
        child.stdin.write(legislatorName + '\n');
        child.stdin.end();

        // Stream stdout
        child.stdout.on('data', (data) => {
          const text = data.toString();
          
          // Check for report path
          const pathMatch = text.match(/Full report saved to: (.+\.md)/);
          if (pathMatch) {
            reportPath = pathMatch[1];
          }
          
          // Send data as Server-Sent Event
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
            type: 'output', 
            text 
          })}\n\n`));
        });

        // Stream stderr
        child.stderr.on('data', (data) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
            type: 'error', 
            text: data.toString() 
          })}\n\n`));
        });

        // Handle completion
        child.on('exit', (code) => {
          if (code === 0) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
              type: 'complete', 
              reportPath,
              success: true 
            })}\n\n`));
          } else {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
              type: 'complete', 
              success: false,
              error: `Process exited with code ${code}` 
            })}\n\n`));
          }
          controller.close();
        });

        // Timeout after 30 minutes
        setTimeout(() => {
          child.kill();
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
            type: 'error', 
            text: 'Report generation timeout' 
          })}\n\n`));
          controller.close();
        }, 1800000);

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
          type: 'error', 
          text: errorMessage 
        })}\n\n`));
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}