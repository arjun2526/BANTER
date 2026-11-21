import { createFileRoute } from "@tanstack/react-router";
import { SignInGate } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { BanterApp } from "@/components/banter/app";
import { AuthScreen, BootScreen } from "@/components/banter/auth-screen";
import { BanterProvider } from "@/components/banter/provider";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const { isPending } = useCurrentUserState();
  if (isPending) return <BootScreen />;
  return (
    <SignInGate fallback={<AuthScreen />}>
      <BanterProvider>
        <BanterApp />
      </BanterProvider>
    </SignInGate>
  );
}
