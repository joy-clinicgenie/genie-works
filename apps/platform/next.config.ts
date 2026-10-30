import type { NextConfig } from "next";
import { loadRootEnv } from "@clinic-genie/db/src/env";

// The repository-level .env is the single source of configuration in development.
loadRootEnv();

const nextConfig: NextConfig = {
  transpilePackages: ["@clinic-genie/db", "@clinic-genie/contracts"],
  serverExternalPackages: ["pg", "embedded-postgres"],
  typedRoutes: false,
  poweredByHeader: false,
  headers: async () => [
    {
      source: "/blog/:id/preview",
      headers: [
        { key: "Cache-Control", value: "private, no-store" },
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ],
    },
    {
      source: "/blog/preview/:token*",
      headers: [
        { key: "Cache-Control", value: "private, no-store" },
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ],
    },
    {
      source: "/(.*)",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ],
    },
  ],
};

export default nextConfig;
