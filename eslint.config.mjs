import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "out/", "dev/", "**/*.d.ts"] },
  ...tseslint.configs.recommended.map((c) => ({
    ...c,
    files: ["src/**/*.ts", "webview-ui/**/*.ts", "webview-ui/**/*.tsx", "test/**/*.ts"],
  })),
  {
    files: ["src/**/*.ts", "webview-ui/**/*.ts", "webview-ui/**/*.tsx", "test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": "off",
    },
  },
);
