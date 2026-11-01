import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { adminPool, appPool, asContext, clientBySlug, staffByEmail, staffCtx } from "./helpers";
import { addSnapshot } from "../src/services/reports";
import { createSavedReport, saveSavedReport, type SavedReportInput } from "../src/services/saved-reports";
import {
  assertArtifactRestoreDirectory,
  defaultReportArtifactDirectory,
  savedReportArtifactFileName,
  storeSavedReportArtifact,
  writeSavedReportArtifact,
  type SavedReportArtifact,
} from "../src/services/report-artifact";

afterAll(async () => {
  await adminPool.end();
  await appPool.end();
});

function sample(reportId = "00000000-0000-4000-8000-000000000001"): SavedReportArtifact {
  return {
    status: "saved",
    reportId,
    versionId: "00000000-0000-4000-8000-000000000002",
    versionNumber: 1,
    clientId: "00000000-0000-4000-8000-000000000003",
    clientName: "Meridian Skin Clinic",
    name: "October saved",
    periodStart: "2030-08-01",
    periodEnd: "2030-08-31",
    comparisonStart: null,
    comparisonEnd: null,
    figures: [{ section: "traffic", metric: "sessions", label: "Sessions", unit: "count", current: 40, previous: null, absoluteChange: null, percentChange: null, status: "recorded" }],
    blocks: [],
    summary: null,
    observations: null,
    actionsTaken: null,
    nextSteps: null,
    limitationNote: null,
    savedAt: "2030-08-31T00:00:00.000Z",
  };
}

function input(clientId: string, name: string): SavedReportInput {
  return {
    clientId,
    name,
    periodStart: "2030-08-01",
    periodEnd: "2030-08-31",
    comparisonStart: null,
    comparisonEnd: null,
    sections: ["traffic"],
    summary: null,
    observations: null,
    actionsTaken: null,
    nextSteps: null,
    dataSourcesNote: null,
    missingConnections: null,
    measurementLimitations: null,
  };
}

describe("saved report copies", () => {
  it("stores a saved copy under docs/report and leaves an existing file unchanged", async () => {
    const directory = defaultReportArtifactDirectory();
    expect(directory.replaceAll("\\", "/")).toMatch(/\/docs\/report$/);
    expect(() => assertArtifactRestoreDirectory(directory, directory)).toThrow(/source copies/);
    expect(() => assertArtifactRestoreDirectory(directory, join(directory, "nested"))).toThrow(/source copies/);
    const artifact = sample();
    const fileName = savedReportArtifactFileName(artifact.reportId, artifact.versionNumber);
    const full = join(directory, fileName);
    try {
      const first = await writeSavedReportArtifact(directory, artifact);
      expect(first).toEqual({ fileName, created: true });
      const changed = { ...artifact, figures: artifact.figures.map((figure) => ({ ...figure, current: 99 })) };
      const second = await writeSavedReportArtifact(directory, changed);
      expect(second.created).toBe(false);
      const stored = JSON.parse(readFileSync(full, "utf8")) as SavedReportArtifact;
      expect(stored.figures[0]?.current).toBe(40);
      expect(stored.status).toBe("saved");
    } finally {
      rmSync(full, { force: true });
    }
  });

  it("refuses a draft and keeps one file when two writes arrive together", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cg-report-"));
    try {
      await expect(writeSavedReportArtifact(directory, { ...sample(), status: "draft" } as unknown as SavedReportArtifact)).rejects.toThrow(/draft/i);
      const artifact = sample("00000000-0000-4000-8000-000000000004");
      const [first, second] = await Promise.all([
        writeSavedReportArtifact(directory, artifact),
        writeSavedReportArtifact(directory, { ...artifact, name: "Other name" }),
      ]);
      expect([first.created, second.created].filter(Boolean)).toHaveLength(1);
      const stored = JSON.parse(readFileSync(join(directory, first.fileName), "utf8")) as SavedReportArtifact;
      expect(["October saved", "Other name"]).toContain(stored.name);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps the first saved figures after a later figure change, and does not store a draft or another client's report", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cg-report-"));
    const admin = await staffByEmail("admin@example.invalid");
    const specialist = await staffByEmail("specialist-b@example.invalid");
    const client = await clientBySlug("meridian-skin");
    try {
      await asContext(staffCtx(admin), async (db) => {
        await addSnapshot(db, client, { source: "ga4_export", channel: "all", metric: "sessions", periodStart: "2030-08-01", periodEnd: "2030-08-31", value: 40, note: null }, admin.id);
        const id = await createSavedReport(db, input(client, "August saved"), admin.id);
        const stored = await storeSavedReportArtifact(db, id, directory);
        expect(stored?.created).toBe(true);
        const firstFile = join(directory, savedReportArtifactFileName(id, 1));
        const first = JSON.parse(readFileSync(firstFile, "utf8")) as SavedReportArtifact;
        expect(first.figures.find((figure) => figure.metric === "sessions")?.current).toBe(40);

        await addSnapshot(db, client, { source: "ga4_export", channel: "all", metric: "sessions", periodStart: "2030-08-01", periodEnd: "2030-08-31", value: 99, note: null }, admin.id);
        await saveSavedReport(db, id, input(client, "August saved again"), admin.id);
        const next = await storeSavedReportArtifact(db, id, directory);
        expect(next?.fileName).toBe(savedReportArtifactFileName(id, 2));
        const unchanged = JSON.parse(readFileSync(firstFile, "utf8")) as SavedReportArtifact;
        expect(unchanged.figures.find((figure) => figure.metric === "sessions")?.current).toBe(40);
        const second = JSON.parse(readFileSync(join(directory, next!.fileName), "utf8")) as SavedReportArtifact;
        expect(second.figures.find((figure) => figure.metric === "sessions")?.current).toBe(99);

        const draftId = await createSavedReport(db, input(client, "August draft"), admin.id, { draft: true });
        expect(await storeSavedReportArtifact(db, draftId, directory)).toBeNull();
        expect(await storeSavedReportArtifact(db, "00000000-0000-4000-8000-000000000099", directory)).toBeNull();
      });
      await expect(asContext(staffCtx(specialist), (db) => createSavedReport(db, input(client, "Not allowed"), specialist.id))).rejects.toThrow();
      expect(await asContext(staffCtx(specialist), (db) => storeSavedReportArtifact(db, "00000000-0000-4000-8000-000000000099", directory))).toBeNull();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
