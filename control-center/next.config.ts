import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  reactCompiler: true,
  output: 'standalone', // For Docker deployment
  transpilePackages: [
    '@codefactory/verdict-engine',
    '@codefactory/deploy-memory',
  ],
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
