import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import { defineConfig } from "vitest/config";
import tailwindcss from "@tailwindcss/vite";

const licenseFile = fileURLToPath(new URL("../LICENSE", import.meta.url));
const iconFile = fileURLToPath(
  new URL("../assets/icons/app-logo.svg", import.meta.url),
);

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    {
      name: "shared-application-icon",
      apply: "serve",
      /**
       * Serve the shared artwork through an ordinary same-origin favicon endpoint.
       * @param server The development server receiving icon requests.
       */
      configureServer(server) {
        server.middlewares.use(async (request, response, next) => {
          if (request.url?.split("?")[0] !== "/favicon.svg") return next();
          try {
            const source = await readFile(iconFile);
            response.setHeader("Content-Type", "image/svg+xml");
            response.setHeader("Cache-Control", "no-cache");
            response.end(source);
          } catch (error) {
            next(error);
          }
        });
      },
      /**
       * Expose a same-origin icon URL versioned by the shared artwork's content.
       * @param html The application entry document.
       * @returns HTML referencing the same source asset used by production builds.
       */
      async transformIndexHtml(html) {
        const version = createHash("sha256")
          .update(await readFile(iconFile))
          .digest("hex")
          .slice(0, 12);
        return html.replace(
          'href="../assets/icons/app-logo.svg"',
          `href="/favicon.svg?v=${version}"`,
        );
      },
    },
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
        iconFile,
        `${iconFile}?raw`,
      ],
    },
  },
  test: {
    include: ["test/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: "./test/setup.ts",
  },
});
