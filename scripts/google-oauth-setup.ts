/**
 * One-time helper: run `pnpm google:auth` after setting GOOGLE_ADS_CLIENT_ID
 * and GOOGLE_ADS_CLIENT_SECRET in .env. Opens the Google consent screen,
 * catches the redirect on localhost, exchanges the code for tokens, and
 * prints the refresh token to paste into .env as GOOGLE_ADS_REFRESH_TOKEN.
 *
 * The OAuth client in Google Cloud Console must have
 * http://localhost:8787/oauth2callback registered as an authorized redirect URI.
 */
import "dotenv/config";
import http from "node:http";
import { URL } from "node:url";
import open from "open";

const PORT = 8787;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
const SCOPE = "https://www.googleapis.com/auth/adwords";

function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Set ${name} in .env first (see .env.example).`);
    process.exit(1);
  }
  return v;
}

const clientId = need("GOOGLE_ADS_CLIENT_ID");
const clientSecret = need("GOOGLE_ADS_CLIENT_SECRET");

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id", clientId);
authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", SCOPE);
authUrl.searchParams.set("access_type", "offline");
authUrl.searchParams.set("prompt", "consent");

const server = http.createServer(async (req, res) => {
  if (!req.url?.startsWith("/oauth2callback")) {
    res.writeHead(404).end();
    return;
  }
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error || !code) {
    res.writeHead(400, { "Content-Type": "text/plain" }).end(`OAuth error: ${error ?? "no code returned"}`);
    console.error("OAuth failed:", error ?? "no code returned");
    server.close();
    process.exit(1);
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: code!,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });

  const tokens = (await tokenRes.json()) as { refresh_token?: string; error?: string; error_description?: string };

  if (!tokens.refresh_token) {
    res
      .writeHead(500, { "Content-Type": "text/plain" })
      .end("No refresh_token in response — see terminal for details.");
    console.error("Token exchange failed:", tokens.error, tokens.error_description);
    server.close();
    process.exit(1);
  }

  res
    .writeHead(200, { "Content-Type": "text/plain" })
    .end("Done — refresh token printed in your terminal. You can close this tab.");

  console.log("\nAdd this to .env:\n");
  console.log(`GOOGLE_ADS_REFRESH_TOKEN=${tokens.refresh_token}\n`);

  server.close();
  process.exit(0);
});

server.listen(PORT, () => {
  console.log(`Opening browser for Google consent (redirecting to localhost:${PORT})...`);
  void open(authUrl.toString());
});
