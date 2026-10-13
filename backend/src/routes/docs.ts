import { Router } from "express";
import specification from "../openapi.json" with { type: "json" };

/** Serve the established API documentation without another runtime dependency. */
export function docsRoutes() {
  const router = Router();

  // Route for serving the OpenAPI specification in JSON format
  router.get("/openapi.json", (_request, response) =>
    response.json(specification),
  );

  // Route for serving the Swagger UI documentation
  router.get("/docs", (_request, response) =>
    response.type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Inventory Manager API</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css"></head>
<body><div id="swagger-ui"></div>
<script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>SwaggerUIBundle({url: "/openapi.json", dom_id: "#swagger-ui"});</script>
</body></html>`),
  );

  // Route for serving the ReDoc documentation
  router.get("/redoc", (_request, response) =>
    response.type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Inventory Manager API</title></head>
<body><redoc spec-url="/openapi.json"></redoc>
<script src="https://cdn.jsdelivr.net/npm/redoc@2/bundles/redoc.standalone.js"></script>
</body></html>`),
  );
  return router;
}
