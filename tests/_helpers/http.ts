/**
 * Shared HTTP JSON fetch helper for API integration tests.
 *
 * Deduplicates the request/parse boilerplate that previously lived in
 * each api test file. Optionally attaches a Bearer token.
 */

import http from "http";

export interface FetchJsonResult {
  status: number;
  body: Record<string, unknown>;
}

export function fetchJson(
  path: string,
  port: number,
  token?: string,
): Promise<FetchJsonResult> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    http
      .get(`http://127.0.0.1:${port}${path}`, { headers }, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: JSON.parse(data),
          });
        });
      })
      .on("error", reject);
  });
}
