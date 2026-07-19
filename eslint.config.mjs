import eslint from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [".cache/", "coverage/", "dist/", "node_modules/", "out/"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: [
      "*.config.{js,ts}",
      "src/main/**/*.ts",
      "src/preload/**/*.ts",
      "src/shared/**/*.ts",
      "test/**/*.ts",
    ],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["src/renderer/src/**/*.{ts,tsx}"],
    ...reactHooks.configs.flat.recommended,
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      "react-refresh": reactRefresh,
    },
    rules: {
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
);
