"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/Button";

export default function ClientsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div role="alert" className="rounded-2xl bg-bad-bg px-4 py-3 text-sm">
      <p className="font-semibold text-bad">This page could not be loaded</p>
      <p className="mt-1 text-ink">Nothing was saved. Check that the local database is running, then try again.</p>
      <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={() => reset()}>
        Try again
      </Button>
    </div>
  );
}
