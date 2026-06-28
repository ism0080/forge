import { createRootRoute, Link, Outlet } from "@tanstack/react-router";

export const Route = createRootRoute({
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
