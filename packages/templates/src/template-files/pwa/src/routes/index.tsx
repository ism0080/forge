import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";

const routeApi = getRouteApi("/");

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const { client } = routeApi.useRouteContext();
  const queryClient = useQueryClient();
  const notes = client.db.collection("notes");

  const { data, isLoading, error } = useQuery({
    queryKey: ["notes"],
    queryFn: () => notes.list({ sortBy: "createdAt", sortDir: "desc" }),
  });

  const createNote = useMutation({
    mutationFn: () =>
      notes.create({ data: { text: `Note ${new Date().toLocaleTimeString()}` } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notes"] }),
  });

  const deleteNote = useMutation({
    mutationFn: (id: string) => notes.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notes"] }),
  });

  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <h1 className="mb-4 text-2xl font-bold">{{siteId}}</h1>
      <p className="mb-4 text-muted-foreground">
        Powered by Forge, React, coss ui, TanStack Query and Router.
      </p>
      <Button
        onClick={() => createNote.mutate()}
        disabled={createNote.isPending}
      >
        Add note
      </Button>
      {isLoading && (
        <p className="mt-4 text-muted-foreground">Loading...</p>
      )}
      {error && (
        <p className="mt-4 text-destructive">
          Could not connect to the Forge server. Run `forge dev` to start it.
        </p>
      )}
      <ul className="mt-4 space-y-2">
        {data?.documents.map((doc) => (
          <li
            key={doc.id}
            className="flex items-center justify-between rounded-lg border p-3"
          >
            <span>{String(doc.data.text ?? "")}</span>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => deleteNote.mutate(doc.id)}
              disabled={deleteNote.isPending}
            >
              Delete
            </Button>
          </li>
        ))}
      </ul>
    </main>
  );
}
