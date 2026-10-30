"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

export function PrintReport({ reportId, versionId }: { reportId: string; versionId?: string }) {
  const [pending, setPending] = useState(false);
  async function onPrint() {
    setPending(true);
    try {
      const response = await fetch(`/reports/${reportId}/serial`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ versionId: versionId ?? null }),
      });
      if (!response.ok) return;
      const issued = await response.json() as { serial: string; fileName: string };
      document.title = issued.fileName;
      const slot = document.getElementById("report-serial");
      if (slot) {
        slot.textContent = `Serial number ${issued.serial}`;
        slot.classList.remove("hidden");
      }
      window.print();
    } finally {
      setPending(false);
    }
  }
  return <Button type="button" variant="secondary" disabled={pending} onClick={onPrint}>{pending ? "Preparing…" : "Print or save as PDF"}</Button>;
}
