import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export async function GET(
  request: NextRequest,
  { params }: { params: { filename: string } }
) {
  try {
    const { filename } = params;
    const filepath = path.join(process.cwd(), 'reports', filename);
    
    // Check if file exists
    try {
      await fs.access(filepath);
    } catch {
      return NextResponse.json(
        { error: 'Report not found' },
        { status: 404 }
      );
    }
    
    // Read the file
    const content = await fs.readFile(filepath, 'utf-8');
    const stats = await fs.stat(filepath);
    
    return NextResponse.json({
      filename,
      content,
      createdAt: stats.birthtime,
      size: stats.size
    });
  } catch (error) {
    console.error('Error reading report:', error);
    return NextResponse.json(
      { error: 'Failed to read report' },
      { status: 500 }
    );
  }
}