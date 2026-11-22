import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { BootScreen } from "@/components/banter/auth-screen";

export const Route = createFileRoute("/u/$username")({
  component: ProfileRedirect,
});

function ProfileRedirect() {
  const { username } = Route.useParams();
  useEffect(() => {
    window.location.replace(`${import.meta.env.BASE_URL}?u=${encodeURIComponent(username)}`);
  }, [username]);
  return <BootScreen label="Opening profile" />;
}
