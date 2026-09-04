import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Bundle workspace TS packages into the Next server build so production
  // `next start` does not need a tsx loader for @pitantir/db.
  transpilePackages: ["@pitantir/shared", "@pitantir/db"],
  serverExternalPackages: ["postgres", "drizzle-orm"],
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"],
    };
    return config;
  },
};

export default nextConfig;
