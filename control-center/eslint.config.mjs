import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Custom rule for admin endpoint authentication
const adminEndpointAuthRule = require('./eslint-rules/admin-endpoint-auth.js');

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    plugins: {
      'custom': {
        rules: {
          'admin-endpoint-auth': adminEndpointAuthRule,
        },
      },
    },
    rules: {
      'custom/admin-endpoint-auth': 'warn',
    },
  },
]);

export default eslintConfig;
