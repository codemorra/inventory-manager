import { fileURLToPath } from "node:url";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import { defineConfig } from "vitest/config";
import tailwindcss from "@tailwindcss/vite";

const licenseFile = fileURLToPath(new URL("../LICENSE", import.meta.url));

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
  ],
  server: {
    fs: {
      allow: [
        fileURLToPath(new URL("./", import.meta.url)),
        // Vite checks both the file path and the raw import identifier.
        licenseFile,
        `${licenseFile}?raw`,
      ],
    },
  },
  test: {
    include: ["test/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: "./test/setup.ts",
  },
});
