import { createRootRouteWithContext, Link, Outlet } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { createClient } from "@ism0080/forge-sdk";

export interface RouterContext {
  queryClient: QueryClient;
  client: Awaited<ReturnType<typeof createClient>>;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
});

function RootComponent() {
  return (
    <>
      <nav className="border-b p-4">
        <Link to="/" className="font-medium">
          Home
        </Link>
      </nav>
      <Outlet />
    </>
  );
}
