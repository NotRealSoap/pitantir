import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@pitantir/shared", "@pitantir/db"],
  // Keep postgres/drizzle out of the webpack graph for server routes.
  serverExternalPackages: ["@pitantir/db", "postgres", "drizzle-orm"],
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
