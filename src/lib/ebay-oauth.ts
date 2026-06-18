import https from "node:https";

export const EBAY_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.inventory.readonly",
].join(" ");

function credentials() {
  return Buffer.from(
    `${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`
  ).toString("base64");
}

function httpsPost(path: string, body: string, extraHeaders: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(body, "utf-8");
    const req = https.request(
      {
        hostname: "api.ebay.com",
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": buf.length,
          ...extraHeaders,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c: Buffer) => { data += c.toString(); });
        res.on("end", () => resolve(data));
      }
    );
    req.on("error", reject);
    req.write(buf);
    req.end();
  });
}

export async function exchangeCodeForTokens(code: string) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: process.env.EBAY_RUNAME!,
  }).toString();

  const raw = await httpsPost("/identity/v1/oauth2/token", body, {
    Authorization: `Basic ${credentials()}`,
  });
  return JSON.parse(raw) as { access_token?: string; refresh_token?: string; error_description?: string };
}

export async function getAccessToken(): Promise<string> {
  const refreshToken = process.env.EBAY_OAUTH_REFRESH_TOKEN;
  if (!refreshToken) throw new Error("eBay not connected — visit /api/ebay/connect first");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: EBAY_SCOPES,
  }).toString();

  const raw = await httpsPost("/identity/v1/oauth2/token", body, {
    Authorization: `Basic ${credentials()}`,
  });
  const data = JSON.parse(raw) as { access_token?: string; error_description?: string };
  if (!data.access_token) throw new Error(data.error_description ?? "Token refresh failed");
  return data.access_token;
}
