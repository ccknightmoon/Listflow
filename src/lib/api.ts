export type ApiFetchOptions = RequestInit & {
  headers?: Record<string, string>;
  redirectOnUnauthorized?: boolean;
};

export async function apiFetch<T = unknown>(
  input: RequestInfo | URL,
  options: ApiFetchOptions = {}
): Promise<T> {
  const { redirectOnUnauthorized = true, ...init } = options;
  const normalizedHeaders = new Headers(init.headers ?? {});

  if (options.headers) {
    Object.entries(options.headers).forEach(([key, value]) => {
      normalizedHeaders.set(key, value);
    });
  }

  normalizedHeaders.set("Accept", "application/json");

  const response = await fetch(input, {
    ...init,
    headers: normalizedHeaders,
  });

  const contentType = response.headers.get("content-type") ?? "";
  const hasJsonBody = contentType.includes("application/json");
  const data = hasJsonBody ? await response.json() : await response.text();

  if (response.status === 401 && redirectOnUnauthorized && typeof window !== "undefined") {
    const nextUrl = new URL("/login", window.location.origin);
    window.location.assign(nextUrl.toString());
  }

  if (!response.ok) {
    const message =
      typeof data === "object" && data && "error" in data && typeof data.error === "string"
        ? data.error
        : `Request failed with status ${response.status}`;

    throw new Error(message);
  }

  return data as T;
}
