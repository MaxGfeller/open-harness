import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@openharness/core", "@openharness/react"],
};

export default nextConfig;
