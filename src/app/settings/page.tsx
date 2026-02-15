import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

async function getWorkspaceData() {
  try {
    const res = await fetch('http://localhost:3000/api/workspace', { 
      cache: 'no-store' 
    });
    if (!res.ok) throw new Error('Failed to fetch');
    return await res.json();
  } catch (e) {
    console.error('Error fetching workspace:', e);
    return { kanban: null, memories: [], cronJobs: [] };
  }
}

export default async function SettingsPage() {
  const data = await getWorkspaceData();
  const cronJobs = data.cronJobs || [];

  return (
    <div className="p-6 h-full">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Settings</h1>
      </div>

      <ScrollArea className="h-[calc(100vh-150px)]">
        <div className="space-y-6">
          {/* Cron Jobs Section */}
          <Card>
            <CardHeader>
              <CardTitle>Scheduled Tasks</CardTitle>
              <CardDescription>Active cron jobs and automations</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {cronJobs.map((job: { name: string; schedule: string; enabled?: boolean }, i: number) => (
                  <div key={i} className="flex items-center justify-between p-3 border rounded-lg">
                    <div>
                      <p className="font-medium">{job.name}</p>
                      <p className="text-sm text-muted-foreground">{job.schedule}</p>
                    </div>
                    <Badge variant={job.enabled ? 'default' : 'secondary'}>
                      {job.enabled ? 'Active' : 'Disabled'}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* System Info */}
          <Card>
            <CardHeader>
              <CardTitle>System</CardTitle>
              <CardDescription>Information about this second brain</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Memory Entries</span>
                  <span>{data.memories?.length || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tasks</span>
                  <span>{data.kanban?.tasks?.length || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Scheduled Jobs</span>
                  <span>{cronJobs.length}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </div>
  );
}
