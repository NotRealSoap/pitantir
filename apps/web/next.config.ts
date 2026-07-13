import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@pitantir/shared", "@pitantir/db"],
};

export default nextConfig;
