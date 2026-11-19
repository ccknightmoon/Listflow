import { request } from "node:https";

interface OpenAIError extends Error {
  status?: number;
  isRateLimit?: boolean;
  /** From OpenAI's retry-after(-ms) headers on 429s. */
  retryAfterMs?: number;
}

// Without a timeout, a stalled connection to OpenAI hung indefinitely — and
// since analyze-batch processes items strictly sequentially, one hung call
// could stall an entire batch with no per-item recovery until the platform's
// own function timeout eventually killed the whole request.
const REQUEST_TIMEOUT_MS = 45_000;

export function openAIPost(apiKey: string, body: object): Promise<object> {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);

    const req = request(
      {
        hostname: "api.openai.com",
        path: "/v1/chat/completions",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "Content-Length": Buffer.byteLength(bodyStr),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve(parsed);
            } else {
              const err: OpenAIError = new Error(
                `OpenAI error ${res.statusCode}: ${parsed?.error?.message ?? data.slice(0, 200)}`
              );
              err.status = res.statusCode;
              err.isRateLimit = res.statusCode === 429;
              const ms = Number(res.headers["retry-after-ms"]);
              const sec = Number(res.headers["retry-after"]);
              if (Number.isFinite(ms) && ms > 0) err.retryAfterMs = ms;
              else if (Number.isFinite(sec) && sec > 0) err.retryAfterMs = sec * 1000;
              reject(err);
            }
          } catch {
            reject(new Error(`Could not parse response: ${data.slice(0, 100)}`));
          }
        });
      }
    );

    req.on("error", reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`OpenAI request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`));
    });
    req.write(bodyStr);
    req.end();
  });
}
