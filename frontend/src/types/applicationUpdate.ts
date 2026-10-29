export type ApplicationUpdate = { current_version: string } & (
  | {
      status: "available" | "current";
      latest_version: string;
      release_url: string;
    }
  | { status: "no_release" | "failed" | "rate_limited" }
);
