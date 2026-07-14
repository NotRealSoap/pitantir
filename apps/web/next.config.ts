import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Client-safe shared code only. @pitantir/db stays server-external (postgres).
  transpilePackages: ["@pitantir/shared"],
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
