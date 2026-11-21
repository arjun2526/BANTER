import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { AuthScreen, BootScreen } from "@/components/banter/auth-screen";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  const { user, isPending } = useCurrentUserState();
  if (isPending) return <BootScreen />;
  if (user) return <Navigate to="/" />;
  return <AuthScreen />;
}
