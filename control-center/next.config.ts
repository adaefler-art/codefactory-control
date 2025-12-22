import type { NextConfig } from "next";

const forcedBuildId = process.env.NEXT_BUILD_ID?.trim();

const nextConfig: NextConfig = {
  reactCompiler: true,
  output: 'standalone', // For Docker deployment
  transpilePackages: [
    '@codefactory/verdict-engine',
    '@codefactory/deploy-memory',
  ],
  ...(forcedBuildId
    ? {
        generateBuildId: async () => forcedBuildId,
      }
    : {}),
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
