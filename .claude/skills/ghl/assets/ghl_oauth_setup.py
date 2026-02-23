#!/usr/bin/env python3
"""
One-time OAuth2 setup for GHL integration.

Usage:
  python3 ghl_oauth_setup.py <client_id> <client_secret>

Prerequisites:
  1. Register a GHL Marketplace app at https://marketplace.gohighlevel.com
  2. Set redirect URI to http://localhost:9876/callback
  3. Enable scopes: conversations, opportunities, contacts (read+write)

This script:
  - Starts a temporary HTTP server on port 9876
  - Opens the GHL OAuth authorization page in your browser
  - Exchanges the auth code for access + refresh tokens
  - Saves tokens to ~/.config/ftl-prints/ghl_tokens.json (mode 0600)
"""

import http.server
import json
import sys
import time
import urllib.request
import urllib.parse
import webbrowser
from pathlib import Path

CALLBACK_PORT = 9876
REDIRECT_URI = f"http://localhost:{CALLBACK_PORT}/callback"
TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token"
AUTHORIZE_URL = "https://marketplace.gohighlevel.com/oauth/chooselocation"
TOKEN_FILE = Path("~/.config/ftl-prints/ghl_tokens.json").expanduser()


def exchange_code(code, client_id, client_secret):
    """Exchange authorization code for tokens."""
    body = json.dumps({
        "client_id": client_id,
        "client_secret": client_secret,
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": REDIRECT_URI,
    }).encode()
    req = urllib.request.Request(
        TOKEN_URL,
        data=body,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "FTL-Prints-Pipeline/1.0",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def main():
    if len(sys.argv) != 3:
        print("Usage: python3 ghl_oauth_setup.py <client_id> <client_secret>")
        sys.exit(1)

    client_id = sys.argv[1]
    client_secret = sys.argv[2]

    # State to capture from callback
    result = {"code": None, "error": None}

    class CallbackHandler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            if "code" in params:
                result["code"] = params["code"][0]
                self.send_response(200)
                self.send_header("Content-Type", "text/html")
                self.end_headers()
                self.wfile.write(b"<h1>Authorization successful!</h1><p>You can close this tab.</p>")
            else:
                result["error"] = params.get("error", ["unknown"])[0]
                self.send_response(400)
                self.send_header("Content-Type", "text/html")
                self.end_headers()
                self.wfile.write(f"<h1>Authorization failed</h1><p>{result['error']}</p>".encode())

        def log_message(self, *a):
            pass

    # Start callback server
    server = http.server.HTTPServer(("127.0.0.1", CALLBACK_PORT), CallbackHandler)

    # Build authorization URL
    auth_params = urllib.parse.urlencode({
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": REDIRECT_URI,
        "scope": "conversations.readonly conversations.write "
                 "opportunities.readonly opportunities.write "
                 "contacts.readonly contacts.write",
    })
    auth_url = f"{AUTHORIZE_URL}?{auth_params}"

    print(f"Opening browser for GHL authorization...")
    print(f"If it doesn't open, visit: {auth_url}")
    webbrowser.open(auth_url)

    # Wait for callback (single request)
    print("Waiting for authorization callback...")
    server.handle_request()
    server.server_close()

    if result["error"]:
        print(f"Authorization failed: {result['error']}")
        sys.exit(1)

    if not result["code"]:
        print("No authorization code received.")
        sys.exit(1)

    # Exchange code for tokens
    print("Exchanging code for tokens...")
    try:
        token_data = exchange_code(result["code"], client_id, client_secret)
    except Exception as e:
        print(f"Token exchange failed: {e}")
        sys.exit(1)

    # Save tokens
    tokens = {
        "access_token": token_data["access_token"],
        "refresh_token": token_data["refresh_token"],
        "expires_at": time.time() + token_data.get("expires_in", 86400),
        "client_id": client_id,
        "client_secret": client_secret,
    }
    TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
    TOKEN_FILE.write_text(json.dumps(tokens, indent=2))
    TOKEN_FILE.chmod(0o600)

    print(f"\nTokens saved to {TOKEN_FILE}")
    print("OAuth2 setup complete. Tokens will auto-refresh — no manual rotation needed.")


if __name__ == "__main__":
    main()
