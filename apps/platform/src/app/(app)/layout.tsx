import { cookies } from "next/headers";
import { LogOut } from "lucide-react";
import { signOut } from "@/lib/auth";
import { requireAccess } from "@/lib/session";
import { canEditClient, canManageRegistry, canManageUsers, listActiveWebsiteClientIds } from "@clinic-genie/db";
import { staffTx } from "@/lib/db";
import { shellClients } from "@/lib/client-registry";
import { Shell, type NavItem } from "@/components/shell/Shell";
import { GREETED_COOKIE } from "@/lib/greeting";
import { Badge } from "@/components/ui/Badge";
import { clientLabel } from "@/lib/client-label";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const access = await requireAccess();
  const jar = await cookies();
  const navCollapsed = jar.get("gw-nav")?.value === "closed";
  // D77: greet once per browser session, on arrival; the session cookie is set by the shell after it greets.
  const greet = !jar.get(GREETED_COOKIE);
  const workspace: NavItem[] = [
    { href: "/", label: "Dashboard", icon: "LayoutDashboard" },
    { href: "/clients", label: "Clients", icon: "Building2" },
  ];
  const modules: NavItem[] = [
    { href: "/seo", label: "SEO performance", icon: "Search" },
    { href: "/analytics", label: "Website analytics", icon: "LineChart" },
    { href: "/enquiries", label: "Leads and forms", icon: "Inbox" },
    { href: "/blog", label: "Blog", icon: "ClipboardList" },
    { href: "/reports", label: "Reports", icon: "BarChart3" },
  ];
  const platform: NavItem[] = [
    { href: "/settings", label: "Settings", icon: "Settings" },
    ...(canManageUsers(access) ? [{ href: "/admin", label: "Admin", icon: "Shield" as const }] : []),
  ];
  const envLabel = process.env.APP_ENVIRONMENT_LABEL || "development";

  async function doSignOut() {
    "use server";
    await signOut({ redirectTo: "/sign-in" });
  }

  const { clients, websiteClientIds } = await staffTx(access, async (db) => ({
    clients: await shellClients(db),
    websiteClientIds: await listActiveWebsiteClientIds(db),
  }));
  const adds = [
    ...(websiteClientIds.some((clientId) => canEditClient(access, clientId)) ? [{ href: "/blog/new", label: "Add blog" }] : []),
    ...(canManageRegistry(access) ? [{ href: "/clients/new", label: "Add client" }] : []),
  ];
  const name = access.user.display_name.trim();
  const role = access.user.platform_role.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "•";
  const header = <Badge tone={envLabel === "production" ? "good" : "warn"}>{envLabel}</Badge>;
  const account = (
    <div className="flex items-center gap-3 group-data-[collapsed=true]/rail:flex-col group-data-[collapsed=true]/rail:gap-2">
      <span aria-hidden="true" title={name} className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-pale text-sm font-semibold text-back">{initials}</span>
      <span className="min-w-0 leading-tight group-data-[collapsed=true]/rail:sr-only">
        <span className="block truncate text-sm font-semibold text-white">{name}</span>
        <span className="block truncate text-xs text-white/60">{role}</span>
      </span>
      <form action={doSignOut} className="ml-auto group-data-[collapsed=true]/rail:ml-0">
        <button type="submit" aria-label="Sign out" className="inline-flex min-h-10 flex-col items-center justify-center gap-0.5 rounded-2xl px-2 text-[11px] font-medium text-white/70 hover:bg-white/10 hover:text-white">
          <LogOut className="size-4" aria-hidden="true" />
          <span className="hidden group-data-[collapsed=true]/rail:block">Log out</span>
        </button>
      </form>
    </div>
  );
  return (
    <Shell workspace={workspace} modules={modules} platform={platform} header={header} account={account} staffName={name} navCollapsed={navCollapsed} greet={greet} clients={clients.map((client) => ({ href: `/clients/${client.id}`, label: clientLabel(client), keywords: [client.short_code, client.public_name, client.legal_name, client.specialty, client.slug].filter(Boolean).join(" ") }))} adds={adds}>
      {children}
    </Shell>
  );
}
