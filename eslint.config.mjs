import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/", "**/node_modules/", "**/.next/", "archive/"],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      // Allow explicit any in pragmatic cases (Prisma result types, etc.)
      "@typescript-eslint/no-explicit-any": "warn",
      // Allow unused vars prefixed with _
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
);
