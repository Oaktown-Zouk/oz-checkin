// One-time setup helper: run `npm run google:auth --workspace server`, open the printed
// URL, approve access with the Google account that owns the waiver form, and paste the
// resulting GOOGLE_REFRESH_TOKEN into .env. Uses a loopback redirect (RFC 8252) since
// Google's old out-of-band ("copy this code") flow is no longer supported for OAuth
// clients — this is why a "Desktop app" OAuth client type is required (it allows any
// localhost port as a redirect URI without pre-registering it).
import "dotenv/config";
import http from "node:http";
import { google } from "googleapis";

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first (see README).");
  process.exit(1);
}

const PORT = 3456;
const redirectUri = `http://localhost:${PORT}/oauth2callback`;
const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: [
    "https://www.googleapis.com/auth/forms.responses.readonly",
    "https://www.googleapis.com/auth/forms.body.readonly",
  ],
});

console.log("Open this URL, sign in with the account that owns the waiver form, and approve access:\n");
console.log(authUrl);
console.log(`\nWaiting for the redirect back to ${redirectUri} ...`);

await new Promise<void>((resolve, reject) => {
  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "", redirectUri);
        const code = url.searchParams.get("code");
        if (!code) {
          res.writeHead(400).end("Missing code");
          return;
        }
        const { tokens } = await oauth2Client.getToken(code);
        res
          .writeHead(200, { "Content-Type": "text/plain" })
          .end("Done — you can close this tab and return to the terminal.");
        console.log("\nAdd this to your .env:\n");
        console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
        server.close();
        resolve();
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    })();
  });
  server.listen(PORT);
});

process.exit(0);
