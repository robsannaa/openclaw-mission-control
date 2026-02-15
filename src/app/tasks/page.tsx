import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

export default async function TasksPage() {
  const data = await getWorkspaceData();
  const kanban = data.kanban;
  const columns = kanban?.columns || [];
  const tasks = kanban?.tasks || [];

  const getTasksByColumn = (columnId: string) => 
    tasks.filter((t: { column: string }) => t.column === columnId);

  return (
    <div className="p-6 h-full">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Tasks</h1>
        <Badge variant="outline">{tasks.length} total</Badge>
      </div>

      <ScrollArea className="h-[calc(100vh-150px)]">
        <div className="flex gap-4 h-full">
          {columns.map((column: { id: string; title: string; color: string }) => (
            <div 
              key={column.id} 
              className="flex-1 min-w-[250px] max-w-[350px]"
            >
              <div 
                className="rounded-lg p-3 mb-3"
                style={{ backgroundColor: column.color + '20' }}
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">{column.title}</h3>
                  <Badge variant="secondary" className="text-xs">
                    {getTasksByColumn(column.id).length}
                  </Badge>
                </div>
              </div>
              
              <div className="space-y-3">
                {getTasksByColumn(column.id).map((task: { id: string; title: string; description?: string; priority?: string; tags?: string[]; assignee?: string; column: string }) => (
                  <Card key={task.id} className="hover:shadow-md transition-shadow">
                    <CardHeader className="py-3 pb-1">
                      <div className="flex items-start justify-between">
                        <CardTitle className="text-sm font-medium leading-tight">
                          {task.title}
                        </CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent className="py-2 pt-0">
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {task.description}
                      </p>
                      <div className="mt-2 flex items-center gap-1 flex-wrap">
                        <Badge 
                          variant={task.priority === 'high' ? 'destructive' : 
                                   task.priority === 'medium' ? 'default' : 'secondary'}
                          className="text-[10px] h-5"
                        >
                          {task.priority}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] h-5">
                          {task.assignee}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
