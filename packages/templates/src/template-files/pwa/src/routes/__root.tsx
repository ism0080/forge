import { createRootRouteWithContext, Link, Outlet } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { createClient } from "@ism0080/forge-sdk";
import { useTheme } from "@/lib/use-theme";
import { Button } from "@/components/ui/button";

export interface RouterContext {
  queryClient: QueryClient;
  client: Awaited<ReturnType<typeof createClient>>;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
});

function RootComponent() {
  const { theme, toggle } = useTheme();

  return (
    <>
      <nav className="flex items-center justify-between border-b p-4">
        <Link to="/" className="font-medium">
          Home
        </Link>
        <Button variant="outline" size="sm" onClick={toggle}>
          {theme === "dark" ? "Light" : "Dark"}
        </Button>
      </nav>
      <Outlet />
    </>
  );
}
