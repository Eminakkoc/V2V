import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./src/test/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["{src,scripts}/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
    globalSetup: ["./src/test/global-setup.ts"],
    clearMocks: true,
  },
});
