import { useState, type FormEvent } from "react";
import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

const routeApi = getRouteApi("/");

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const { client } = routeApi.useRouteContext();
  const queryClient = useQueryClient();
  const notes = client.db.collection("notes");
  const [text, setText] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["notes"],
    queryFn: () => notes.list({ sortBy: "createdAt", sortDir: "desc" }),
  });

  const createNote = useMutation({
    mutationFn: () =>
      notes.create({ data: { text: text || `Note ${new Date().toLocaleTimeString()}` } }),
    onSuccess: () => {
      setText("");
      queryClient.invalidateQueries({ queryKey: ["notes"] });
    },
  });

  const deleteNote = useMutation({
    mutationFn: (id: string) => notes.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notes"] }),
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    createNote.mutate();
  };

  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <Card className="mx-auto max-w-xl">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{"{{siteId}}"}</CardTitle>
            <Badge>Offline ready</Badge>
          </div>
          <CardDescription>
            Powered by Forge, React, shadcn/ui, TanStack Query and Router.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="mb-4 flex gap-2">
            <Input
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Add a note..."
              className="flex-1"
            />
            <Button type="submit" loading={createNote.isPending}>
              Add
            </Button>
          </form>

          {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
          {error && (
            <p className="text-sm text-destructive">
              Could not connect to the Forge server. Run `forge dev` to start it.
            </p>
          )}

          <ul className="space-y-2">
            {data?.documents.map((doc) => (
              <li
                key={doc.id}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <span className="text-sm">{String(doc.data.text ?? "")}</span>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => deleteNote.mutate(doc.id)}
                  loading={deleteNote.isPending}
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </main>
  );
}