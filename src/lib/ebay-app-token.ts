// eBay application access token (client-credentials grant, basic
// api_scope), cached per server instance. Used by the Browse API (pricing)
// and the Notification API (account-deletion signature keys). Server only.
import https from "node:https";

let cache: { token: string; expires: number } | null = null;
let inflight: Promise<string> | null = null;

export function ebayHttps(options: https.RequestOptions, body?: string, timeoutMs = 10_000): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c: Buffer) => { data += c.toString(); });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => { req.destroy(new Error("Request timeout")); });
    if (body) req.write(body);
    req.end();
  });
}

export async function getAppToken(): Promise<string> {
  if (cache && cache.expires > Date.now() + 60_000) return cache.token;
  if (inflight) return inflight;
  inflight = (async () => {
    const id = process.env.EBAY_CLIENT_ID!;
    const secret = process.env.EBAY_CLIENT_SECRET!;
    const creds = Buffer.from(`${id}:${secret}`).toString("base64");
    const body = "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope";
    const { status, body: resBody } = await ebayHttps(
      {
        hostname: "api.ebay.com",
        path: "/identity/v1/oauth2/token",
        method: "POST",
        headers: {
          Authorization: `Basic ${creds}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      body
    );
    if (status !== 200) throw new Error(`App token fetch failed: ${status} ${resBody.slice(0, 200)}`);
    const data = JSON.parse(resBody) as { access_token: string; expires_in: number };
    cache = { token: data.access_token, expires: Date.now() + data.expires_in * 1000 };
    return data.access_token;
  })().finally(() => { inflight = null; });
  return inflight;
}
