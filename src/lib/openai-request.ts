import { request } from "node:https";

interface OpenAIError extends Error {
  status?: number;
  isRateLimit?: boolean;
}

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
              reject(err);
            }
          } catch {
            reject(new Error(`Could not parse response: ${data.slice(0, 100)}`));
          }
        });
      }
    );

    req.on("error", reject);
    req.write(bodyStr);
    req.end();
  });
}
