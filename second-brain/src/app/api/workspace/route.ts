import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getDefaultWorkspaceSync } from "@/lib/paths";

const WORKSPACE_DIR = getDefaultWorkspaceSync();

export async function GET() {
  try {
    // Read memory files
    const memoryDir = path.join(WORKSPACE_DIR, 'memory');
    const memories: { date: string; content: string }[] = [];
    
    if (fs.existsSync(memoryDir)) {
      const files = fs.readdirSync(memoryDir).filter(f => f.endsWith('.md'));
      for (const file of files) {
        const date = file.replace('.md', '');
        const content = fs.readFileSync(path.join(memoryDir, file), 'utf-8');
        memories.push({ date, content });
      }
    }
    
    // Read key workspace files
    const readFile = (filename: string) => {
      const filepath = path.join(WORKSPACE_DIR, filename);
      if (fs.existsSync(filepath)) {
        return fs.readFileSync(filepath, 'utf-8');
      }
      return null;
    };
    
    const kanban = readFile('kanban.json');
    
    // Read cron jobs (approximate - would need gateway API in real app)
    const cronJobs: { name: string; schedule: string; enabled: boolean }[] = [
      { name: 'Morning Brief', schedule: '8:00 AM', enabled: true },
      { name: 'Daily CEO Brief - Versa', schedule: '8:00 AM', enabled: true },
      { name: 'System Health Check', schedule: 'Every 6 hours', enabled: true },
      { name: 'Keep Browser Running', schedule: 'Every 5 min', enabled: true },
    ];
    
    return NextResponse.json({
      memories,
      kanban: kanban ? JSON.parse(kanban) : null,
      cronJobs,
      workspaceFiles: {
        AGENTS: readFile('AGENTS.md'),
        USER: readFile('USER.md'),
        SOUL: readFile('SOUL.md'),
        TOOLS: readFile('TOOLS.md'),
        IDENTITY: readFile('IDENTITY.md'),
      }
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
