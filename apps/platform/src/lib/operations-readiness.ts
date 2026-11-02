import { isSharedDatabaseUrl, type PlatformSyncHealth } from "@clinic-genie/db";

const PLACEHOLDER_AUTH_SECRETS = new Set(["preview-build-only", "replace-with-a-long-random-string"]);
const STALE_SYNC_MS = 36 * 60 * 60 * 1000;

type RuntimeEnv = Record<string, string | undefined>;

export type DeploymentClass = "local-rehearsal" | "connected-staging" | "production" | "unassigned-remote";
export type SecretState = "missing" | "placeholder" | "set";
export type EnquirySourceState = "not-configured" | "refused" | "unreachable" | "reachable";
export type SyncFreshness = "unavailable" | "no-connections" | "not-synchronised" | "current" | "stale" | "failed";

export interface OperationsReport {
  deploymentClass: DeploymentClass;
  runtimeProcess: "development" | "production" | "other";
  enquiryFixturePermitted: boolean;
  authSecret: SecretState;
  database: "missing" | "local" | "shared";
  workerBearer: "missing" | "set";
  enquirySource: EnquirySourceState;
  enquiryLive: boolean;
  sync: {
    readable: boolean;
    connections: number;
    queued: number;
    leased: number;
    stalledLeases: number;
    failed: number;
    reconnectRequired: number;
    lastSuccessAt: string | null;
    freshness: SyncFreshness;
    safeError: string | null;
  };
  failedNotifications: number | null;
  backup: "none" | "passed" | "other";
  restoreTest: "none" | "passed" | "other";
  signals: string[];
}

/** Matches the enquiry-fixture production refusal. Preview is refused when the process itself is production, which is how a hosted preview runs. */
export function enquiryFixturePermitted(env: RuntimeEnv): boolean {
  return env.NODE_ENV !== "production" && env.VERCEL_ENV !== "production";
}

export function deploymentClass(env: RuntimeEnv): DeploymentClass {
  if (env.VERCEL_ENV === "production") return "production";
  if (env.VERCEL_ENV === "preview") return "connected-staging";
  const url = env.DATABASE_URL ?? "";
  if (!url.trim() || !isSharedDatabaseUrl(url)) return "local-rehearsal";
  if (env.NODE_ENV === "production") return "production";
  return "unassigned-remote";
}

export function secretState(value: string | undefined): SecretState {
  if (!value) return "missing";
  if (PLACEHOLDER_AUTH_SECRETS.has(value)) return "placeholder";
  return "set";
}

function databaseState(url: string | undefined): "missing" | "local" | "shared" {
  if (!url?.trim()) return "missing";
  return isSharedDatabaseUrl(url) ? "shared" : "local";
}

function authUrlState(value: string | undefined): "missing" | "local" | "set" {
  if (!value?.trim()) return "missing";
  try {
    const host = new URL(value).hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return "local";
    return "set";
  } catch {
    return "missing";
  }
}

function outcomeState(outcome: string | null): "none" | "passed" | "other" {
  if (!outcome) return "none";
  return outcome === "passed" ? "passed" : "other";
}

function freshness(sync: PlatformSyncHealth | null, now: Date): SyncFreshness {
  if (!sync) return "unavailable";
  if (sync.failed > 0 || sync.reconnectRequired > 0 || sync.stalledLeases > 0) return "failed";
  if (sync.connections === 0) return "no-connections";
  if (!sync.lastSuccessAt) return "not-synchronised";
  if (now.getTime() - sync.lastSuccessAt.getTime() > STALE_SYNC_MS) return "stale";
  return "current";
}

export function assembleOperationsReport(input: {
  env: RuntimeEnv;
  enquiry: { configured: boolean; reachable: boolean; refused: boolean; live?: boolean };
  failedNotifications: number | null;
  sync: PlatformSyncHealth | null;
  backupOutcome: string | null;
  restoreOutcome: string | null;
  now?: Date;
}): OperationsReport {
  const now = input.now ?? new Date();
  const deployment = deploymentClass(input.env);
  const enquirySource: EnquirySourceState = !input.enquiry.configured
    ? "not-configured"
    : input.enquiry.refused
      ? "refused"
      : input.enquiry.reachable
        ? "reachable"
        : "unreachable";
  const sync = input.sync;
  const syncView = {
    readable: sync !== null,
    connections: sync?.connections ?? 0,
    queued: sync?.queued ?? 0,
    leased: sync?.leased ?? 0,
    stalledLeases: sync?.stalledLeases ?? 0,
    failed: sync?.failed ?? 0,
    reconnectRequired: sync?.reconnectRequired ?? 0,
    lastSuccessAt: sync?.lastSuccessAt ? sync.lastSuccessAt.toISOString() : null,
    freshness: freshness(sync, now),
    safeError: sync?.safeError ?? null,
  };
  const report: OperationsReport = {
    deploymentClass: deployment,
    runtimeProcess: input.env.NODE_ENV === "production" ? "production" : input.env.NODE_ENV === "development" ? "development" : "other",
    enquiryFixturePermitted: enquiryFixturePermitted(input.env),
    authSecret: secretState(input.env.AUTH_SECRET),
    database: databaseState(input.env.DATABASE_URL),
    workerBearer: input.env.ANALYTICS_WORKER_SECRET?.trim() || input.env.CRON_SECRET?.trim() ? "set" : "missing",
    enquirySource,
    enquiryLive: input.enquiry.live === true,
    sync: syncView,
    failedNotifications: enquirySource === "reachable" ? input.failedNotifications : null,
    backup: outcomeState(input.backupOutcome),
    restoreTest: outcomeState(input.restoreOutcome),
    signals: [],
  };
  report.signals = operationSignals(report, authUrlState(input.env.AUTH_URL));
  return report;
}

function operationSignals(report: OperationsReport, authUrl: "missing" | "local" | "set"): string[] {
  const signals = [`Environment class is ${report.deploymentClass.replaceAll("-", " ")}.`];
  if (!report.enquiryFixturePermitted) {
    signals.push("This process refuses the enquiry fixture before a read or write.");
  }
  if (report.authSecret === "missing") signals.push("AUTH_SECRET is missing.");
  if (report.authSecret === "placeholder") signals.push("AUTH_SECRET is a build placeholder and cannot be used at runtime.");
  if (report.database === "missing") signals.push("DATABASE_URL is missing.");
  if ((report.deploymentClass === "connected-staging" || report.deploymentClass === "production") && report.database === "local") {
    signals.push("The application database is on this machine. Connected staging and production need their own database.");
  }
  if (report.deploymentClass === "unassigned-remote") {
    signals.push("The application database is not on this machine, and no staging project is selected. This is not connected staging.");
  }
  if ((report.deploymentClass === "connected-staging" || report.deploymentClass === "production") && authUrl !== "set") {
    signals.push("AUTH_URL is missing or points at this machine.");
  }
  if (report.workerBearer === "missing" && (report.deploymentClass === "connected-staging" || report.deploymentClass === "production")) {
    signals.push("No analytics worker bearer is set. A hosted cron cannot authenticate.");
  }
  if (report.workerBearer === "missing" && report.deploymentClass === "local-rehearsal") {
    signals.push("No analytics worker bearer is set. The prepared cron entry is not a hosted schedule.");
  }
  if (report.enquirySource === "not-configured") signals.push("The enquiry database is not connected.");
  if (report.enquirySource === "refused") signals.push("The enquiry database target was refused before a read or write.");
  if (report.enquirySource === "unreachable") signals.push("The enquiry database could not be reached. No messages were copied.");
  if (report.enquirySource === "reachable" && report.enquiryLive) {
    signals.push("The live enquiry database is connected. Messages stay in that database.");
  } else if (report.enquirySource === "reachable") {
    signals.push("The enquiry source passed the local fixture check. That is not an approved live source.");
  }
  if (report.enquirySource === "reachable" && report.failedNotifications !== null) {
    signals.push(`Failed clinic notifications: ${report.failedNotifications}. A failed row is not mailbox delivery.`);
  }
  if (report.sync.freshness === "unavailable") signals.push("Analytics synchronisation status could not be read.");
  if (report.sync.freshness === "failed") {
    signals.push("Analytics synchronisation has failed, reconnect-required, or stalled jobs.");
    if (report.sync.safeError) signals.push(`Latest safe analytics error code: ${report.sync.safeError}.`);
  }
  if (report.sync.freshness === "stale") signals.push("The last successful analytics synchronisation is older than 36 hours.");
  if (report.sync.freshness === "not-synchronised") signals.push("Analytics connections have no successful synchronisation recorded.");
  if (report.sync.freshness === "no-connections") signals.push("No active analytics connection is recorded.");
  if (report.sync.freshness === "current") {
    signals.push("The last successful analytics synchronisation is within 36 hours. This is not a live provider check.");
  }
  if (report.backup === "none") signals.push("No backup run is recorded.");
  if (report.backup === "other") signals.push("The latest recorded backup did not pass.");
  if (report.restoreTest === "none") signals.push("No restore test is recorded.");
  if (report.restoreTest === "other") signals.push("The latest recorded restore test did not pass.");
  return signals;
}
