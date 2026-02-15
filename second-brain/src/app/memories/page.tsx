import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

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

export default async function MemoriesPage() {
  const data = await getWorkspaceData();
  const memories = data.memories || [];

  // Sort by date descending
  memories.sort((a: any, b: any) => b.date.localeCompare(a.date));

  return (
    <div className="p-6 h-full">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Memories</h1>
        <Badge variant="outline">{memories.length} entries</Badge>
      </div>

      <ScrollArea className="h-[calc(100vh-150px)]">
        <div className="space-y-4">
          {memories.length === 0 ? (
            <p className="text-muted-foreground">No memories found</p>
          ) : (
            memories.map((memory: any) => (
              <Card key={memory.date}>
                <CardHeader className="py-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">{memory.date}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="py-2">
                  <div className="prose prose-sm max-w-none dark:prose-invert">
                    {memory.content.split('\n').map((line: string, i: number) => {
                      if (line.startsWith('## ')) {
                        return <h3 key={i} className="text-md font-semibold mt-4 mb-2">{line.replace('## ', '')}</h3>;
                      }
                      if (line.startsWith('### ')) {
                        return <h4 key={i} className="text-sm font-semibold mt-3 mb-1">{line.replace('### ', '')}</h4>;
                      }
                      if (line.startsWith('- ')) {
                        return <li key={i} className="ml-4">{line.replace('- ', '')}</li>;
                      }
                      if (line.trim()) {
                        return <p key={i} className="my-1">{line}</p>;
                      }
                      return null;
                    })}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
