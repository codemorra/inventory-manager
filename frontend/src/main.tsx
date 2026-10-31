import { PreferenceBootstrap } from "./components/PreferenceBootstrap";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./queryClient";

import App from "./App";
import "./App.css";
import "./i18n";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <PreferenceBootstrap>
        <App />
      </PreferenceBootstrap>
    </QueryClientProvider>
  </StrictMode>,
);
