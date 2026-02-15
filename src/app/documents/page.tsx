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
    return { kanban: null, memories: [], cronJobs: [], workspaceFiles: {} };
  }
}

export default async function DocumentsPage() {
  const data = await getWorkspaceData();
  const files = data.workspaceFiles || {};

  const documentSections = [
    { key: 'USER', title: 'User Profile', description: 'Information about Rob' },
    { key: 'SOUL', title: 'Personality', description: 'My core traits and behavior' },
    { key: 'IDENTITY', title: 'Identity', description: 'My name, emoji, and role' },
    { key: 'TOOLS', title: 'Tools & Credentials', description: 'API keys and integrations' },
    { key: 'AGENTS', title: 'Agent Configuration', description: 'Workspace setup and rules' },
  ];

  return (
    <div className="p-6 h-full">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Documents</h1>
        <Badge variant="outline">{documentSections.length} files</Badge>
      </div>

      <ScrollArea className="h-[calc(100vh-150px)]">
        <div className="grid gap-4">
          {documentSections.map((section) => (
            <Card key={section.key}>
              <CardHeader className="py-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">{section.title}</CardTitle>
                  <Badge variant="secondary" className="text-xs">{section.key}.md</Badge>
                </div>
                <p className="text-sm text-muted-foreground">{section.description}</p>
              </CardHeader>
              <CardContent className="py-2">
                {files[section.key] ? (
                  <div className="prose prose-sm max-w-none dark:prose-invert">
                    {files[section.key].split('\n').slice(0, 30).map((line: string, i: number) => {
                      if (line.startsWith('## ')) {
                        return <h3 key={i} className="text-md font-semibold mt-4 mb-2">{line.replace('## ', '')}</h3>;
                      }
                      if (line.startsWith('### ')) {
                        return <h4 key={i} className="text-sm font-semibold mt-3 mb-1">{line.replace('### ', '')}</h4>;
                      }
                      if (line.startsWith('- ')) {
                        return <li key={i} className="ml-4">{line.replace('- ', '')}</li>;
                      }
                      if (line.startsWith('```')) {
                        return null;
                      }
                      if (line.trim()) {
                        return <p key={i} className="my-1">{line}</p>;
                      }
                      return null;
                    })}
                    {files[section.key].split('\n').length > 30 && (
                      <p className="text-muted-foreground text-sm">... (more content)</p>
                    )}
                  </div>
                ) : (
                  <p className="text-muted-foreground">No content</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
