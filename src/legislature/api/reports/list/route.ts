import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export async function GET(request: NextRequest) {
  try {
    const reportsDir = path.join(process.cwd(), 'reports');
    
    // Ensure reports directory exists
    try {
      await fs.access(reportsDir);
    } catch {
      await fs.mkdir(reportsDir, { recursive: true });
      return NextResponse.json({ reports: [] });
    }

    // Read all markdown files
    const files = await fs.readdir(reportsDir);
    const mdFiles = files.filter(f => f.endsWith('.md'));
    
    // Get file stats and content preview
    const reports = await Promise.all(mdFiles.map(async (filename) => {
      const filepath = path.join(reportsDir, filename);
      const stats = await fs.stat(filepath);
      const content = await fs.readFile(filepath, 'utf-8');
      
      // Extract legislator name from filename
      const nameMatch = filename.match(/^(.+?)_(thinking|comprehensive|enhanced)_/);
      const legislatorName = nameMatch ? nameMatch[1].replace(/_/g, ' ') : filename;
      
      // Extract first few lines for preview
      const lines = content.split('\n');
      const preview = lines.slice(0, 10).join('\n');
      
      return {
        filename,
        filepath,
        legislatorName,
        createdAt: stats.birthtime,
        size: stats.size,
        preview
      };
    }));
    
    // Sort by creation date, newest first
    reports.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    
    return NextResponse.json({ reports });
  } catch (error) {
    console.error('Error listing reports:', error);
    return NextResponse.json(
      { error: 'Failed to list reports' },
      { status: 500 }
    );
  }
}