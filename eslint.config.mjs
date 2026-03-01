import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

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
  // Prevent direct imports of internal modules — use @/lib/openclaw instead.
  {
    files: ["src/app/**/*.ts", "src/app/**/*.tsx", "src/components/**/*.ts", "src/components/**/*.tsx"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [
          {
            name: "@/lib/openclaw-cli",
            message: "Import from '@/lib/openclaw' instead. openclaw-cli is an internal module used only by transports.",
          },
          {
            name: "@/lib/openclaw-client",
            message: "Import from '@/lib/openclaw' instead. openclaw-client is an internal module.",
          },
        ],
      }],
    },
  },
]);

export default eslintConfig;
