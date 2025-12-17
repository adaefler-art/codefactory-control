import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  reactCompiler: true,
  output: 'standalone', // For Docker deployment
  transpilePackages: [
    '@codefactory/verdict-engine',
    '@codefactory/deploy-memory',
  ],
  turbopack: {
    // Use monorepo root so Turbopack can resolve workspace packages
    root: path.resolve(__dirname, ".."),
  },
};

export default nextConfig;
