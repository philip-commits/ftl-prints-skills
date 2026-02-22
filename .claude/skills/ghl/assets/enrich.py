#!/usr/bin/env python3
"""
Enrichment layer for FTL Prints GHL pipeline.

Reads:
  /tmp/ftl_pipeline.json  — Phase 1 parsed pipeline data
  /tmp/ftl_convos.json    — Phase 2 conversation metadata (optional)

Writes:
  /tmp/ftl_enriched.json  — Enriched leads with suggestedAction, priority, hints
"""

import json
import sys
from datetime import datetime, timezone

# --- International phone prefixes (calls will fail via Twilio) ---
INTL_PREFIXES = ("+41", "+44", "+1-242", "+1242", "+1-246", "+1246", "+1-268", "+1268")

# --- Custom field keys that matter for quoting ---
INFO_FIELDS = ["artwork", "sizes", "quantity", "project_details"]

PIPELINE_FILE = "/tmp/ftl_pipeline.json"
CONVOS_FILE = "/tmp/ftl_convos.json"
OUTPUT_FILE = "/tmp/ftl_enriched.json"


def load_json(path):
    with open(path) as f:
        return json.load(f)


def is_international(phone):
    """Check if phone number is international (calls will fail)."""
    if not phone:
        return False
    normalized = phone.strip().replace(" ", "").replace("(", "").replace(")", "").replace("-", "")
    for prefix in INTL_PREFIXES:
        clean_prefix = prefix.replace("-", "")
        if normalized.startswith(clean_prefix):
            return True
    return False


def get_missing_info(lead):
    """Return list of missing custom field names needed for quoting."""
    missing = []
    for field in INFO_FIELDS:
        val = lead.get(field)
        if val is None or val == "" or val == []:
            missing.append(field)
    return missing


def check_waiting_on_artwork(lead):
    """Check if project_details suggests artwork is forthcoming."""
    details = (lead.get("project_details") or "").lower()
    return "will provide" in details or "new logo" in details


def enrich_from_opportunity(lead):
    """Compute fields derived from opportunity data only."""
    phone = lead.get("phone", "")
    enriched = {
        "isInternational": is_international(phone),
        "missingInfo": get_missing_info(lead),
        "waitingOnArtwork": check_waiting_on_artwork(lead),
        "hasArtwork": bool(lead.get("artwork")) and lead.get("artwork") != [],
        "hasQuantity": bool(lead.get("quantity")),
        "hasSizes": bool(lead.get("sizes")),
        "hasProjectDetails": bool(lead.get("project_details")),
    }
    return enriched


def enrich_from_conversation(lead, convo):
    """Compute fields derived from conversation metadata."""
    if convo is None:
        return {
            "needsReply": False,
            "hasManualOutreach": False,
            "daysSinceLastContact": None,
            "noConversation": True,
            "conversationId": None,
        }

    now = datetime.now(timezone.utc)
    days_since = None
    last_date = convo.get("lastMessageDate") or convo.get("lastManualMessageDate")
    if last_date:
        try:
            if isinstance(last_date, (int, float)):
                # Epoch timestamp in milliseconds
                dt = datetime.fromtimestamp(last_date / 1000, tz=timezone.utc)
            else:
                dt = datetime.fromisoformat(last_date.replace("Z", "+00:00"))
            days_since = (now - dt).days
        except (ValueError, TypeError, OSError):
            pass

    return {
        "needsReply": (convo.get("unreadCount", 0) or 0) > 0
            and convo.get("lastMessageDirection") == "inbound",
        "hasManualOutreach": convo.get("lastOutboundMessageAction") == "manual",
        "daysSinceLastContact": days_since,
        "noConversation": False,
        "conversationId": convo.get("conversationId"),
    }


def decide_action(lead):
    """
    Decision tree — first match wins.

    Returns (suggestedAction, suggestedPriority, hint).
    """
    stage = lead.get("stage", "")
    days_in_stage = lead.get("days_in_stage", 0)
    needs_reply = lead.get("needsReply", False)
    has_manual = lead.get("hasManualOutreach", False)
    is_intl = lead.get("isInternational", False)

    # 1. Needs reply — inbound message waiting
    if needs_reply:
        return ("reply", "high", "Inbound message waiting — reply needed")

    # 2. New Lead or no manual outreach yet
    if stage == "New Lead" or not has_manual:
        return ("outreach", "high", f"{'New lead' if stage == 'New Lead' else 'No manual outreach yet'} — send personalized welcome")

    # 3. Stale lead — 10+ days, no reply
    if days_in_stage >= 10 and not needs_reply:
        return ("move", "info", f"{days_in_stage} days in {stage} with no response — suggest move to Cooled Off")

    # 4. Domestic follow-up — 1+ day, can call
    if days_in_stage >= 1 and not is_intl:
        return ("call", "high", f"{days_in_stage} day(s) no response, domestic — call them")

    # 5. International follow-up — 1+ day, can't call
    if days_in_stage >= 1 and is_intl:
        return ("follow_up_email", "medium", f"{days_in_stage} day(s) no response, international — email only")

    # 6. Default — no action needed
    return ("none", "none", "Contacted recently, waiting for response")


def main():
    # Load pipeline data (required)
    try:
        pipeline = load_json(PIPELINE_FILE)
    except FileNotFoundError:
        print(f"ERROR: {PIPELINE_FILE} not found. Run Phase 1 first.", file=sys.stderr)
        sys.exit(1)

    # Load conversation data (optional — graceful degradation)
    convos = {}
    try:
        convos = load_json(CONVOS_FILE)
    except FileNotFoundError:
        print(f"WARNING: {CONVOS_FILE} not found. Proceeding with opportunity-only data.",
              file=sys.stderr)

    active = pipeline.get("active", [])
    enriched_leads = []

    for lead in active:
        contact_id = lead.get("contactId", "")

        # Merge opportunity-derived fields
        lead.update(enrich_from_opportunity(lead))

        # Merge conversation-derived fields
        convo = convos.get(contact_id)
        lead.update(enrich_from_conversation(lead, convo))

        # Run decision tree
        action, priority, hint = decide_action(lead)
        lead["suggestedAction"] = action
        lead["suggestedPriority"] = priority
        lead["hint"] = hint

        enriched_leads.append(lead)

    # Build output
    output = {
        "leads": enriched_leads,
        "inactiveSummary": pipeline.get("inactive_summary", {}),
        "inactiveContacts": pipeline.get("inactive_contacts", []),
    }

    with open(OUTPUT_FILE, "w") as f:
        json.dump(output, f, indent=2)

    # Print summary
    action_counts = {}
    priority_counts = {}
    for lead in enriched_leads:
        a = lead["suggestedAction"]
        p = lead["suggestedPriority"]
        action_counts[a] = action_counts.get(a, 0) + 1
        priority_counts[p] = priority_counts.get(p, 0) + 1

    print(f"Enriched {len(enriched_leads)} active leads.")
    print(f"  Actions: {action_counts}")
    print(f"  Priorities: {priority_counts}")
    if not convos:
        print("  (no conversation data — used opportunity-only enrichment)")
    print(f"Output written to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
