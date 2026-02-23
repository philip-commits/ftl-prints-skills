#!/usr/bin/env python3
"""
Fetch conversation metadata for active pipeline leads via GHL REST API.

Reads:
  /tmp/ftl_pipeline.json   — Phase 1 parsed pipeline data

Writes:
  /tmp/ftl_convos.json     — Conversation metadata keyed by contactId
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ghl_auth import get_access_token

PIPELINE_FILE = "/tmp/ftl_pipeline.json"
OUTPUT_FILE = "/tmp/ftl_convos.json"
LOCATION_ID = "iCyLg9rh8NtPpTfFCcGk"
GHL_BASE = "https://services.leadconnectorhq.com"
MAX_WORKERS = 3



def fetch_outbound_count(conversation_id, auth):
    """Fetch messages for a conversation and count outbound ones."""
    url = f"{GHL_BASE}/conversations/{conversation_id}/messages?limit=100"
    req = urllib.request.Request(url, headers={
        "Authorization": auth,
        "Version": "2021-07-28",
        "Accept": "application/json",
        "User-Agent": "FTL-Prints-Pipeline/1.0",
    })
    for attempt in range(2):
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                body = json.loads(resp.read())
            messages = body.get("messages", body.get("data", []))
            count = sum(1 for m in messages if m.get("direction") == "outbound")
            return count
        except urllib.error.HTTPError as e:
            if e.code in (500, 503) and attempt == 0:
                time.sleep(2)
                continue
            return None
        except Exception:
            if attempt == 0:
                time.sleep(2)
                continue
            return None


def fetch_conversation(contact_id, auth):
    """Fetch conversation metadata + outbound count for a single contact. Returns (contactId, data|None)."""
    url = (f"{GHL_BASE}/conversations/search"
           f"?contactId={contact_id}&locationId={LOCATION_ID}")
    req = urllib.request.Request(url, headers={
        "Authorization": auth,
        "Version": "2021-07-28",
        "Accept": "application/json",
        "User-Agent": "FTL-Prints-Pipeline/1.0",
    })

    for attempt in range(2):
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                body = json.loads(resp.read())
            conversations = body.get("conversations", [])
            if not conversations:
                return (contact_id, None)
            convo = conversations[0]
            convo_id = convo.get("id")

            # Fetch outbound message count
            outbound_count = fetch_outbound_count(convo_id, auth) if convo_id else None

            return (contact_id, {
                "unreadCount": convo.get("unreadCount", 0),
                "lastMessageDirection": convo.get("lastMessageDirection"),
                "lastMessageDate": convo.get("lastMessageDate"),
                "lastMessageType": convo.get("lastMessageType"),
                "lastOutboundMessageAction": convo.get("lastOutboundMessageAction"),
                "lastManualMessageDate": convo.get("lastManualMessageDate"),
                "conversationId": convo_id,
                "outboundCount": outbound_count,
            })
        except urllib.error.HTTPError as e:
            if e.code == 401:
                print("ERROR: 401 Unauthorized from GHL API.", file=sys.stderr)
                print("Token expired or invalid. To fix:", file=sys.stderr)
                print("  python3 .claude/skills/ghl/assets/ghl_oauth_setup.py <client_id> <client_secret>", file=sys.stderr)
                print("Or update the PIT token in ~/.claude/mcp.json", file=sys.stderr)
                sys.exit(1)
            if e.code in (500, 503) and attempt == 0:
                time.sleep(2)
                continue
            print(f"  WARNING: HTTP {e.code} for contact {contact_id}, skipping",
                  file=sys.stderr)
            return (contact_id, None)
        except Exception as e:
            if attempt == 0:
                time.sleep(2)
                continue
            print(f"  WARNING: {e} for contact {contact_id}, skipping",
                  file=sys.stderr)
            return (contact_id, None)


def main():
    # Load pipeline data
    try:
        pipeline = json.loads(Path(PIPELINE_FILE).read_text())
    except FileNotFoundError:
        print(f"ERROR: {PIPELINE_FILE} not found. Run Phase 1 first.", file=sys.stderr)
        sys.exit(1)

    active = pipeline.get("active", [])
    contact_ids = [lead["contactId"] for lead in active if lead.get("contactId")]
    print(f"Fetching conversations for {len(contact_ids)} active leads...")

    # Load auth once (read-only, shared across threads)
    auth = get_access_token()

    # Fetch concurrently with max 3 workers (respects GHL rate limit)
    results = {}
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(fetch_conversation, cid, auth): cid
                   for cid in contact_ids}
        for future in as_completed(futures):
            contact_id, data = future.result()
            results[contact_id] = data

    # Write output
    Path(OUTPUT_FILE).write_text(json.dumps(results, indent=2))

    # Summary
    found = sum(1 for v in results.values() if v is not None)
    unread = sum(1 for v in results.values()
                 if v and (v.get("unreadCount") or 0) > 0)
    print(f"Done. {found}/{len(contact_ids)} contacts have conversations "
          f"({unread} with unread messages).")
    print(f"Output written to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
