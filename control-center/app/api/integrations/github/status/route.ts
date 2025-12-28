import { NextResponse } from "next/server";
import crypto from "node:crypto";

const GH_API = "https://api.github.com";
const API_VERSION = "2022-11-28";

function b64url(buf: Buffer) {
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function appJwt(appId: string, privateKeyPem: string) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = b64url(Buffer.from(JSON.stringify({ iss: appId, iat: now - 30, exp: now + 9 * 60 })));
  const unsigned = `${header}.${payload}`;

  const sign = crypto.createSign("RSA-SHA256");
  sign.update(unsigned);
  sign.end();
  const sig = sign.sign(privateKeyPem);
  return `${unsigned}.${b64url(sig)}`;
}

export async function GET() {
  const appId = process.env.GH_APP_ID;
  const key   = process.env.GH_APP_PRIVATE_KEY_PEM;
  const owner = process.env.GH_OWNER;
  const repo  = process.env.GH_REPO;

  if (!appId || !key || !owner || !repo) {
    return NextResponse.json({ status: "RED", reason: "missing_env" });
  }

  try {
    const jwt = appJwt(appId, key);

    // 1) installation id for this repo
    const instRes = await fetch(`${GH_API}/repos/${owner}/${repo}/installation`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION,
        "User-Agent": "AFU-9",
        Authorization: `Bearer ${jwt}`,
      },
      cache: "no-store",
    });
    if (!instRes.ok) return NextResponse.json({ status: "RED", reason: `installation_${instRes.status}` });

    const inst = await instRes.json();

    // 2) installation token
    const tokRes = await fetch(`${GH_API}/app/installations/${inst.id}/access_tokens`, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION,
        "User-Agent": "AFU-9",
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: "{}",
      cache: "no-store",
    });
    if (!tokRes.ok) return NextResponse.json({ status: "RED", reason: `token_${tokRes.status}` });

    const tok = await tokRes.json();

    // 3) proof call: can we read the repo?
    const repoRes = await fetch(`${GH_API}/repos/${owner}/${repo}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION,
        "User-Agent": "AFU-9",
        Authorization: `token ${tok.token}`,
      },
      cache: "no-store",
    });

    if (!repoRes.ok) return NextResponse.json({ status: "RED", reason: `repo_${repoRes.status}` });

    const r = await repoRes.json();
    return NextResponse.json({ status: "GREEN", repo: r.full_name });
  } catch (e: any) {
    return NextResponse.json({ status: "RED", reason: "exception", error: e?.message ?? String(e) });
  }
}
