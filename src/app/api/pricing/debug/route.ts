import { NextResponse } from "next/server";
import https from "node:https";

export const runtime = "nodejs";

function httpsPost(path: string, body: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(body, "utf-8");
    const req = https.request(
      {
        hostname: "api.ebay.com",
        path,
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": buf.length, ...headers },
      },
      (res) => {
        let data = "";
        res.on("data", (c: Buffer) => { data += c.toString(); });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
      }
    );
    req.on("error", reject);
    req.write(buf);
    req.end();
  });
}

export async function GET() {
  const id = process.env.EBAY_CLIENT_ID;
  const secret = process.env.EBAY_CLIENT_SECRET;

  if (!id || !secret) {
    return NextResponse.json({ error: "env vars missing", hasId: !!id, hasSecret: !!secret });
  }

  const creds = Buffer.from(`${id}:${secret}`).toString("base64");

  // Test 1: node:https token fetch
  let nodeResult: { status?: number; body?: string; error?: string } = {};
  try {
    const r = await httpsPost(
      "/identity/v1/oauth2/token",
      "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope",
      { Authorization: `Basic ${creds}` }
    );
    nodeResult = { status: r.status, body: r.status === 200 ? "TOKEN OK" : r.body.slice(0, 300) };
  } catch (e) {
    nodeResult = { error: (e as Error).message };
  }

  // Test 2: fetch() token fetch
  let fetchResult: { status?: number; body?: string; error?: string } = {};
  try {
    const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
      method: "POST",
      headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope",
    });
    fetchResult = { status: res.status, body: res.ok ? "TOKEN OK" : (await res.text()).slice(0, 300) };
  } catch (e) {
    fetchResult = { error: (e as Error).message };
  }

  return NextResponse.json({
    idPrefix: id.slice(0, 12),
    idLen: id.length,
    secretLen: secret.length,
    nodeHttps: nodeResult,
    fetchApi: fetchResult,
  });
}
