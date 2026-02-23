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



def fetch_notes(contact_id, auth):
    """Fetch the last 5 notes for a contact, sorted by dateAdded descending."""
    url = f"{GHL_BASE}/contacts/{contact_id}/notes"
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
            notes_raw = body.get("notes", [])
            # Sort by dateAdded descending, take last 5
            notes_raw.sort(key=lambda n: n.get("dateAdded", ""), reverse=True)
            return [{"body": n.get("body", ""), "dateAdded": n.get("dateAdded", "")}
                    for n in notes_raw[:5]]
        except urllib.error.HTTPError as e:
            if e.code in (500, 503) and attempt == 0:
                time.sleep(2)
                continue
            return []
        except Exception:
            if attempt == 0:
                time.sleep(2)
                continue
            return []


def fetch_outbound_count(conversation_id, auth):
    """Fetch messages for a conversation, count outbound ones, and track per-channel timestamps."""
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
            # Messages may be nested: body["messages"]["messages"] or flat
            raw = body.get("messages", body.get("data", []))
            if isinstance(raw, dict):
                messages = raw.get("messages", [])
            else:
                messages = raw

            # Direction lives at top level for SMS/CALL, but in meta.email.direction for EMAIL
            def get_direction(m):
                d = m.get("direction")
                if d:
                    return d
                meta = m.get("meta")
                if isinstance(meta, dict):
                    for v in meta.values():
                        if isinstance(v, dict) and "direction" in v:
                            return v["direction"]
                return None

            count = sum(1 for m in messages if get_direction(m) == "outbound")

            # Track most recent outbound timestamp per channel (direct only, not campaign)
            channel_map = {
                "TYPE_CALL": "lastOutboundCallDate",
                "TYPE_SMS": "lastOutboundSmsDate",
                "TYPE_EMAIL": "lastOutboundEmailDate",
            }
            channel_dates = {v: None for v in channel_map.values()}
            for m in messages:
                if get_direction(m) != "outbound":
                    continue
                msg_type = m.get("messageType", "")
                if msg_type not in channel_map:
                    continue
                ts = m.get("dateAdded") or m.get("createdAt")
                if ts and (channel_dates[channel_map[msg_type]] is None
                           or ts > channel_dates[channel_map[msg_type]]):
                    channel_dates[channel_map[msg_type]] = ts

            return count, channel_dates
        except urllib.error.HTTPError as e:
            if e.code in (500, 503) and attempt == 0:
                time.sleep(2)
                continue
            return None, {}
        except Exception:
            if attempt == 0:
                time.sleep(2)
                continue
            return None, {}


def fetch_conversation(contact_id, auth, stage=""):
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
                if stage != "New Lead":
                    notes = fetch_notes(contact_id, auth)
                    if notes:
                        return (contact_id, {"notes": notes})
                return (contact_id, None)
            convo = conversations[0]
            convo_id = convo.get("id")

            # Fetch outbound message count + per-channel timestamps
            if convo_id:
                outbound_count, channel_dates = fetch_outbound_count(convo_id, auth)
            else:
                outbound_count, channel_dates = None, {}

            # Fetch contact notes (skip for New Leads — they won't have any)
            notes = fetch_notes(contact_id, auth) if stage != "New Lead" else []

            result = {
                "unreadCount": convo.get("unreadCount", 0),
                "lastMessageDirection": convo.get("lastMessageDirection"),
                "lastMessageDate": convo.get("lastMessageDate"),
                "lastMessageType": convo.get("lastMessageType"),
                "lastOutboundMessageAction": convo.get("lastOutboundMessageAction"),
                "lastManualMessageDate": convo.get("lastManualMessageDate"),
                "conversationId": convo_id,
                "outboundCount": outbound_count,
                "notes": notes,
            }
            result.update(channel_dates)
            return (contact_id, result)
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
    leads = [(lead["contactId"], lead.get("stage", ""))
             for lead in active if lead.get("contactId")]
    print(f"Fetching conversations for {len(leads)} active leads...")

    # Load auth once (read-only, shared across threads)
    auth = get_access_token()

    # Fetch concurrently with max 3 workers (respects GHL rate limit)
    results = {}
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(fetch_conversation, cid, auth, stage): cid
                   for cid, stage in leads}
        for future in as_completed(futures):
            contact_id, data = future.result()
            results[contact_id] = data

    # Write output
    Path(OUTPUT_FILE).write_text(json.dumps(results, indent=2))

    # Summary
    found = sum(1 for v in results.values() if v is not None)
    unread = sum(1 for v in results.values()
                 if v and (v.get("unreadCount") or 0) > 0)
    with_notes = sum(1 for v in results.values()
                     if v and len(v.get("notes") or []) > 0)
    print(f"Done. {found}/{len(leads)} contacts have conversations "
          f"({unread} with unread messages, {with_notes} with notes).")
    print(f"Output written to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
