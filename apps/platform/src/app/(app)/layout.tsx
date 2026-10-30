import { LogOut } from "lucide-react";
import { signOut } from "@/lib/auth";
import { requireAccess } from "@/lib/session";
import { canEditClient, canManageRegistry, canManageUsers, listBlogWebsites, listClients } from "@clinic-genie/db";
import { staffTx } from "@/lib/db";
import { Shell, type NavItem } from "@/components/shell/Shell";
import { Badge } from "@/components/ui/Badge";
import { clientLabel } from "@/lib/client-label";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const access = await requireAccess();
  const workspace: NavItem[] = [
    { href: "/", label: "Dashboard", icon: "LayoutDashboard" },
    { href: "/clients", label: "Clients", icon: "Building2" },
  ];
  const modules: NavItem[] = [
    { href: "/analytics", label: "Website analytics", icon: "LineChart" },
    { href: "/seo", label: "SEO performance", icon: "Search" },
    { href: "/blog", label: "Blog", icon: "ClipboardList" },
    { href: "/enquiries", label: "Leads and forms", icon: "Inbox" },
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

  const { clients, websites } = await staffTx(access, async (db) => ({
    clients: await listClients(db),
    websites: await listBlogWebsites(db),
  }));
  const adds = [
    ...(websites.some((site) => canEditClient(access, site.client_id)) ? [{ href: "/blog/new", label: "Add blog" }] : []),
    ...(canManageRegistry(access) ? [{ href: "/clients/new", label: "Add client" }] : []),
  ];
  const name = access.user.display_name.trim();
  const role = access.user.platform_role.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "•";
  const header = <Badge tone={envLabel === "production" ? "good" : "warn"}>{envLabel}</Badge>;
  const account = (
    <div className="flex items-center gap-3 group-data-[collapsed=true]/rail:flex-col group-data-[collapsed=true]/rail:gap-2">
      <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-pale text-sm font-semibold text-action">{initials}</span>
      <span className="min-w-0 leading-tight group-data-[collapsed=true]/rail:hidden">
        <span className="block truncate text-sm font-semibold text-ink">{name}</span>
        <span className="block truncate text-xs text-muted">{role}</span>
        <span className="mt-1.5 hidden lg:block"><Badge tone={envLabel === "production" ? "good" : "warn"}>{envLabel}</Badge></span>
      </span>
      <form action={doSignOut} className="ml-auto group-data-[collapsed=true]/rail:ml-0">
        <button type="submit" aria-label="Sign out" className="inline-flex size-10 items-center justify-center rounded-full text-muted hover:bg-brand-pale hover:text-action">
          <LogOut className="size-4" aria-hidden="true" />
        </button>
      </form>
    </div>
  );
  return (
    <Shell workspace={workspace} modules={modules} platform={platform} header={header} account={account} staffName={name} clients={clients.map((client) => ({ href: `/clients/${client.id}`, label: clientLabel(client), keywords: [client.short_code, client.public_name, client.legal_name, client.specialty, client.slug].filter(Boolean).join(" ") }))} adds={adds}>
      {children}
    </Shell>
  );
}
