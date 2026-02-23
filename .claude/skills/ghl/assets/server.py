import http.server, json, os, sys, time, urllib.request, urllib.error
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ghl_auth import get_access_token

PORT = 8787
ACTIONS_FILE = "/tmp/ftl_actions.json"
SENT_FILE = "/tmp/ftl_sent.json"
HTML_FILE = Path(__file__).resolve().parent / "dashboard.html"

# Defensive check — actions file must exist before starting
if not Path(ACTIONS_FILE).exists():
    print(f"ERROR: {ACTIONS_FILE} not found. Run /ghl first to generate action data.")
    raise SystemExit(1)

GHL_BASE = "https://services.leadconnectorhq.com"

data = json.loads(Path(ACTIONS_FILE).read_text())
actions = data.get("actions", data) if isinstance(data, dict) else data
sent = json.loads(Path(SENT_FILE).read_text()) if Path(SENT_FILE).exists() else {}


class H(http.server.BaseHTTPRequestHandler):
    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(length)) if length else {}

    def do_GET(self):
        if self.path == "/":
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(Path(HTML_FILE).read_bytes())
        elif self.path == "/api/actions":
            self._json(200, data)
        elif self.path == "/api/status":
            self._json(200, sent)
        else:
            self._respond(404, "text/plain", b"Not found")

    def do_POST(self):
        if self.path.startswith("/api/send/"):
            raw_id = self.path.split("/")[-1]  # e.g. "5", "5_sms", "5_email"
            aid = int(raw_id.split("_")[0])
            action = next((a for a in actions if a["id"] == aid), None)
            if not action:
                return self._json(404, {"success": False, "error": "Action not found"})
            req_body = self._read_body()
            msg_type = req_body.get("type", action.get("messageType", "Email"))
            body = {"type": msg_type, "contactId": action["contactId"]}
            if msg_type == "Email":
                body.update({
                    "subject": req_body.get("subject", action.get("subject", "")),
                    "html": req_body.get("html", ""),
                    "message": req_body.get("message", action.get("message", "")),
                    "emailFrom": "sales@ftlprints.com",
                })
            else:
                body["message"] = req_body.get("message", action.get("message", ""))
            try:
                req = urllib.request.Request(
                    f"{GHL_BASE}/conversations/messages",
                    data=json.dumps(body).encode(),
                    headers={"Authorization": get_access_token(), "Version": "2021-07-28", "Content-Type": "application/json", "User-Agent": "FTL-Prints-Pipeline/1.0"},
                    method="POST")
                with urllib.request.urlopen(req) as resp:
                    result = json.loads(resp.read())
                sent[raw_id] = {"status": "sent", "ts": time.time()}
                Path(SENT_FILE).write_text(json.dumps(sent))
                self._json(200, {"success": True, "messageId": result.get("messageId", "")})
            except urllib.error.HTTPError as e:
                self._json(e.code, {"success": False, "error": e.read().decode()})
            except Exception as e:
                self._json(500, {"success": False, "error": str(e)})

        elif self.path.startswith("/api/note/"):
            aid = int(self.path.split("/")[-1])
            action = next((a for a in actions if a["id"] == aid), None)
            if not action:
                return self._json(404, {"success": False, "error": "Action not found"})
            req_body = self._read_body()
            note_body = req_body.get("body", "")
            try:
                req = urllib.request.Request(
                    f"{GHL_BASE}/contacts/{action['contactId']}/notes",
                    data=json.dumps({"body": note_body}).encode(),
                    headers={"Authorization": get_access_token(), "Version": "2021-07-28", "Content-Type": "application/json", "User-Agent": "FTL-Prints-Pipeline/1.0"},
                    method="POST")
                with urllib.request.urlopen(req) as resp:
                    json.loads(resp.read())
                sent[str(aid)] = {"status": "noted", "ts": time.time()}
                Path(SENT_FILE).write_text(json.dumps(sent))
                self._json(200, {"success": True})
            except urllib.error.HTTPError as e:
                self._json(e.code, {"success": False, "error": e.read().decode()})
            except Exception as e:
                self._json(500, {"success": False, "error": str(e)})

        elif self.path.startswith("/api/dismiss/"):
            aid = self.path.split("/")[-1]
            sent[str(aid)] = {"status": "dismissed", "ts": time.time()}
            Path(SENT_FILE).write_text(json.dumps(sent))
            self._json(200, {"success": True})

        elif self.path.startswith("/api/move/"):
            aid = int(self.path.split("/")[-1])
            action = next((a for a in actions if a["id"] == aid), None)
            if not action:
                return self._json(404, {"success": False, "error": "Action not found"})
            body = {"pipelineStageId": action.get("targetStageId", "")}
            try:
                req = urllib.request.Request(
                    f"{GHL_BASE}/opportunities/{action['opportunityId']}",
                    data=json.dumps(body).encode(),
                    headers={"Authorization": get_access_token(), "Version": "2021-07-28", "Content-Type": "application/json", "User-Agent": "FTL-Prints-Pipeline/1.0"},
                    method="PUT")
                with urllib.request.urlopen(req) as resp:
                    json.loads(resp.read())
                sent[str(aid)] = {"status": "moved", "ts": time.time()}
                Path(SENT_FILE).write_text(json.dumps(sent))
                self._json(200, {"success": True})
            except urllib.error.HTTPError as e:
                self._json(e.code, {"success": False, "error": e.read().decode()})
            except Exception as e:
                self._json(500, {"success": False, "error": str(e)})
        else:
            self._respond(404, "text/plain", b"Not found")

    def _respond(self, code, ctype, body):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code, data):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def log_message(self, *a):
        pass


print(f"FTL Prints action server running on http://localhost:{PORT}")
http.server.HTTPServer(("", PORT), H).serve_forever()
