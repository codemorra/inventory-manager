import express, { type Express } from "express";

/**
 * Serve production assets and the known browser routes after API routing.
 * @param app The application receiving static and browser routes.
 * @param directory The absolute directory containing the built frontend.
 */
export function registerFrontendServing(app: Express, directory: string) {
  app.use(express.static(directory, { index: false, redirect: false }));
  app.get(
    /^\/(?:settings|inventories\/[^/]+\/(?:items|fields))?\/*$/,
    (request, response, next) => {
      if (!request.accepts("html")) return next();
      response.set("Cache-Control", "no-cache");
      response.sendFile("index.html", { root: directory }, (error) => {
        if (error) next(error);
      });
    },
  );
}
