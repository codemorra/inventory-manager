import type { ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";

/** Join HTTP lifetimes and asynchronous service work before closing the active database. */
export function createRuntimeActivity() {
  const pending = new Set<Promise<unknown>>();
  const requests = new WeakMap<ServerResponse, () => void>();
  function track<T>(promise: Promise<T>): Promise<T> {
    pending.add(promise);
    void promise.then(
      () => pending.delete(promise),
      () => pending.delete(promise),
    );
    return promise;
  }
  return {
    track,
    request(response: ServerResponse) {
      void track(
        new Promise<void>((resolve) => {
          const done = () => {
            requests.delete(response);
            response.off("finish", done);
            response.off("close", done);
            resolve();
          };
          requests.set(response, done);
          response.once("finish", done);
          response.once("close", done);
        }),
      );
    },
    exclude(response: ServerResponse) {
      requests.get(response)?.();
    },
    async idle() {
      while (pending.size) await Promise.allSettled([...pending]);
    },
    services<T extends Record<string, object | null>>(services: T): T {
      return Object.fromEntries(
        Object.entries(services).map(([key, service]) => [
          key,
          !service || key === "storageLocations"
            ? service
            : new Proxy(service, {
                get(target, name) {
                  const method: unknown = Reflect.get(target, name);
                  if (typeof method !== "function") return method;
                  return (...args: unknown[]) => {
                    const result: unknown = Reflect.apply(method, target, args);
                    if (!(result instanceof Promise)) return result;
                    return track(
                      result.then((value: unknown) => {
                        if (
                          value &&
                          typeof value === "object" &&
                          "stream" in value &&
                          value.stream instanceof Readable
                        )
                          void track(finished(value.stream).catch(() => {}));
                        return value;
                      }),
                    );
                  };
                },
              }),
        ]),
      ) as T;
    },
  };
}
