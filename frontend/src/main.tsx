import { PreferenceBootstrap } from "./components/PreferenceBootstrap";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import App from "./App";
import "./App.css";
import "./i18n";

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <PreferenceBootstrap>
        <App />
      </PreferenceBootstrap>
    </QueryClientProvider>
  </StrictMode>,
);
