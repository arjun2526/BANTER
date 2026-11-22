import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { BootScreen } from "@/components/banter/auth-screen";

export const Route = createFileRoute("/join/$code")({
  component: JoinRedirect,
});

function JoinRedirect() {
  const { code } = Route.useParams();
  useEffect(() => {
    window.location.replace(`${import.meta.env.BASE_URL}?join=${encodeURIComponent(code)}`);
  }, [code]);
  return <BootScreen label="Opening your invite" />;
}
