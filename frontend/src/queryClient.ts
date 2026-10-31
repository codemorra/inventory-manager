import { QueryClient } from "@tanstack/react-query";

// Share cached queries between route loading and the rendered application.
export const queryClient = new QueryClient();
