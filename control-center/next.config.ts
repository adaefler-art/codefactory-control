import type { NextConfig } from "next";

const forcedBuildId = (
  process.env.NEXT_BUILD_ID ||
  process.env.BUILD_COMMIT_HASH ||
  process.env.GITHUB_SHA
)?.trim();

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
  // Ensure lawbook JSON files are available in standalone build
  outputFileTracingIncludes: {
    '/api/lawbook/*': ['./src/lawbook/*.json'],
  },
};

export default nextConfig;
