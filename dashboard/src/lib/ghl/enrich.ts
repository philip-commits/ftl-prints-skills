import { NON_US_NANP_AREA_CODES, NON_NANP_INTL_PREFIXES } from "../constants";
import type { ParsedLead, ConversationMeta, EnrichedLead, NoteEntry, MessageEntry } from "./types";

const INFO_FIELDS = ["artwork", "sizes", "quantity", "project_details"];

const COOLDOWN_MULTI_CHANNEL = 3;
const COOLDOWN_CALL = 3;
const COOLDOWN_EMAIL = 2;
const COOLDOWN_BYPASS_ACTIONS = new Set(["reply", "outreach", "move"]);

const BUDGET_TIERS: Record<string, string> = {
  "$0 - $149": "low",
  "$150 - $499": "standard",
  "$500 - $999": "standard",
  "$1,000+": "high",
};

function isInternational(phone: string): boolean {
  if (!phone) return false;
  const normalized = phone.replace(/[\s()-]/g, "");
  for (const prefix of NON_NANP_INTL_PREFIXES) {
    if (normalized.startsWith(prefix.replace("-", ""))) return true;
  }
  if (normalized.startsWith("+1") && normalized.length >= 5) {
    const areaCode = normalized.slice(2, 5);
    return NON_US_NANP_AREA_CODES.has(areaCode);
  }
  return false;
}

function businessDaysSince(dt: Date, now: Date = new Date()): number {
  const start = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (start >= end) return 0;
  let count = 0;
  const current = new Date(start);
  current.setDate(current.getDate() + 1);
  while (current <= end) {
    const dow = current.getDay();
    if (dow !== 0 && dow !== 6) count++;
    current.setDate(current.getDate() + 1);
  }
  return count;
}

function approxBusinessDays(calendarDays: number | null): number {
  if (calendarDays === null || calendarDays <= 0) return 0;
  const fullWeeks = Math.floor(calendarDays / 7);
  const remainder = calendarDays % 7;
  return fullWeeks * 5 + Math.min(remainder, 5);
}

function parseTimestamp(ts: string | number | null | undefined): Date | null {
  if (ts == null) return null;
  try {
    if (typeof ts === "number") return new Date(ts > 1e12 ? ts : ts * 1000);
    return new Date(ts);
  } catch {
    return null;
  }
}

function getValueTier(lead: ParsedLead): string {
  const budget = lead.budget || "";
  if (budget in BUDGET_TIERS) return BUDGET_TIERS[budget];
  const mv = lead.monetaryValue || 0;
  if (mv >= 1000) return "high";
  if (mv >= 150) return "standard";
  return "low";
}

function getMissingInfo(lead: ParsedLead): string[] {
  const missing: string[] = [];
  for (const field of INFO_FIELDS) {
    const val = (lead as unknown as Record<string, unknown>)[field];
    if (val === undefined || val === null || val === "" || (Array.isArray(val) && val.length === 0)) {
      missing.push(field);
    }
  }
  return missing;
}

function checkWaitingOnArtwork(lead: ParsedLead): boolean {
  const details = (lead.project_details || "").toLowerCase();
  return details.includes("will provide") || details.includes("new logo");
}

interface EnrichmentFields {
  isInternational: boolean;
  missingInfo: string[];
  waitingOnArtwork: boolean;
  hasArtwork: boolean;
  hasQuantity: boolean;
  hasSizes: boolean;
  hasProjectDetails: boolean;
}

function enrichFromOpportunity(lead: ParsedLead): EnrichmentFields {
  return {
    isInternational: isInternational(lead.phone),
    missingInfo: getMissingInfo(lead),
    waitingOnArtwork: checkWaitingOnArtwork(lead),
    hasArtwork: Boolean(lead.artwork) && (lead.artwork as string[]).length > 0,
    hasQuantity: Boolean(lead.quantity),
    hasSizes: Boolean(lead.sizes),
    hasProjectDetails: Boolean(lead.project_details),
  };
}

interface ConvoFields {
  needsReply: boolean;
  hasManualOutreach: boolean;
  daysSinceLastContact: number | null;
  daysSinceLastCall: number | null;
  daysSinceLastSms: number | null;
  daysSinceLastEmail: number | null;
  outboundCount: number;
  noConversation: boolean;
  conversationId: string | null;
  notes: NoteEntry[];
  conversationHistory: MessageEntry[];
}

function enrichFromConversation(convo: ConversationMeta | null): ConvoFields {
  if (!convo) {
    return {
      needsReply: false,
      hasManualOutreach: false,
      daysSinceLastContact: null,
      daysSinceLastCall: null,
      daysSinceLastSms: null,
      daysSinceLastEmail: null,
      outboundCount: 0,
      noConversation: true,
      conversationId: null,
      notes: [],
      conversationHistory: [],
    };
  }

  const now = new Date();
  let daysSince: number | null = null;
  const lastDate = convo.lastMessageDate || convo.lastManualMessageDate;
  if (lastDate) {
    const dt = parseTimestamp(lastDate);
    if (dt) daysSince = businessDaysSince(dt, now);
  }

  const channelFields = [
    { src: convo.lastOutboundCallDate, key: "daysSinceLastCall" },
    { src: convo.lastOutboundSmsDate, key: "daysSinceLastSms" },
    { src: convo.lastOutboundEmailDate, key: "daysSinceLastEmail" },
  ];
  const channelDays: Record<string, number | null> = {};
  for (const { src, key } of channelFields) {
    const dt = parseTimestamp(src);
    channelDays[key] = dt ? businessDaysSince(dt, now) : null;
  }

  return {
    needsReply:
      (convo.unreadCount || 0) > 0 && convo.lastMessageDirection === "inbound",
    hasManualOutreach: convo.lastOutboundMessageAction === "manual",
    daysSinceLastContact: daysSince,
    daysSinceLastCall: channelDays.daysSinceLastCall,
    daysSinceLastSms: channelDays.daysSinceLastSms,
    daysSinceLastEmail: channelDays.daysSinceLastEmail,
    outboundCount: convo.outboundCount || 0,
    noConversation: false,
    conversationId: convo.conversationId || null,
    notes: convo.notes || [],
    conversationHistory: convo.messages || [],
  };
}

type ActionResult = [string, string, string]; // [action, priority, hint]

function decideAction(lead: EnrichedLead): ActionResult {
  const stage = lead.stage || "";
  const needsReply = lead.needsReply;
  const hasManual = lead.hasManualOutreach;
  const isIntl = lead.isInternational;
  const tier = getValueTier(lead);
  const outboundCount = lead.outboundCount || 0;

  let bdays = lead.daysSinceLastContact;
  if (bdays === null) {
    bdays = approxBusinessDays(lead.days_in_stage);
  }

  const minAttempts = tier === "high" ? 4 : 3;

  const thresholds: Record<string, Record<string, number | null>> = {
    high: { call: 1, followup: 3, final: 6, hv_extra: 10, move: 14 },
    standard: { call: 1, followup: 3, final: 6, hv_extra: null, move: 10 },
    low: { call: 1, followup: 2, final: 5, hv_extra: null, move: 7 },
  };

  let t: Record<string, number | null>;
  if (stage === "Quote Sent") {
    t = { call: 1, followup: 2, final: 5, hv_extra: null, move: 7 };
  } else {
    t = thresholds[tier] || thresholds.standard;
  }

  // 1. Needs reply
  if (needsReply) return ["reply", "high", "Inbound message waiting — reply needed"];

  // 2. New Lead or no manual outreach
  if (stage === "New Lead" || !hasManual) {
    const label = stage === "New Lead" ? "New lead" : "No manual outreach yet";
    return ["outreach", "high", `${label} — send personalized welcome`];
  }

  // 3. Needs Attention
  if (stage === "Needs Attention") {
    if (bdays >= t.move! && outboundCount >= minAttempts)
      return ["move", "high", `Needs Attention but ${bdays} bdays, ${outboundCount} attempts — consider Cooled Off`];
    if (isIntl) return ["follow_up_email", "high", "Flagged for attention — international, email only"];
    return ["call", "high", "Flagged for attention — call or email"];
  }

  // 4. Quote Sent
  if (stage === "Quote Sent") {
    if (bdays >= t.move! && outboundCount >= minAttempts)
      return ["move", "info", `${bdays} bdays since quote sent, ${outboundCount} attempts, no response — move to Cooled Off`];
    if (bdays >= t.move!)
      return ["follow_up_email", "medium", `${bdays} bdays since quote sent but only ${outboundCount}/${minAttempts} attempts — follow up before closing`];
    if (bdays >= t.final!)
      return ["final_attempt_email", "medium", `${bdays} bdays since quote sent — final follow-up before closing`];
    if (bdays >= t.followup!)
      return ["follow_up_email", "medium", `${bdays} bdays since quote sent — check if they have questions`];
    if (bdays >= t.call!) {
      if (isIntl) return ["follow_up_email", "medium", `${bdays} bday(s) since quote sent, international — email follow-up`];
      return ["call", "high", `${bdays} bday(s) since quote sent — call to discuss`];
    }
    return ["none", "none", "Quote sent recently, waiting for response"];
  }

  // 5. High-value extra attempt
  if (tier === "high" && t.hv_extra !== null && bdays >= t.hv_extra && bdays < t.move!)
    return ["high_value_followup", "high", `High-value lead at ${bdays} bdays — extra attempt before closing out`];

  // 6. Move threshold
  if (bdays >= t.move! && outboundCount >= minAttempts)
    return ["move", "info", `${bdays} bdays in ${stage}, ${outboundCount} attempts, no response — move to Cooled Off`];
  if (bdays >= t.move!)
    return ["follow_up_email", "medium", `${bdays} bdays in ${stage} but only ${outboundCount}/${minAttempts} attempts — follow up before closing`];

  // 7. Final attempt
  if (bdays >= t.final!)
    return ["final_attempt_email", "medium", `${bdays} bdays no response — final follow-up before moving to Cooled Off`];

  // 8. Follow-up email
  if (bdays >= t.followup!)
    return ["follow_up_email", "medium", `${bdays} bdays no response — follow-up email`];

  // 9. First follow-up (1+ bday)
  if (bdays >= t.call!) {
    if (isIntl) return ["follow_up_email", "medium", `${bdays} bday(s) no response, international — email only`];
    return ["call", "high", `${bdays} bday(s) no response, domestic — call them`];
  }

  // 10. Default
  return ["none", "none", "Contacted recently, waiting for response"];
}

function applyCooldown(lead: EnrichedLead, action: string, priority: string, hint: string): ActionResult {
  if (COOLDOWN_BYPASS_ACTIONS.has(action)) return [action, priority, hint];

  const daysCall = lead.daysSinceLastCall;
  const daysSms = lead.daysSinceLastSms;
  const daysEmail = lead.daysSinceLastEmail;

  // Multi-channel full press detection
  if (daysCall !== null && (daysSms !== null || daysEmail !== null)) {
    const others = [daysSms, daysEmail].filter((d): d is number => d !== null);
    const other = Math.min(...others);
    if (Math.abs(daysCall - other) <= 1) {
      const mostRecent = Math.min(daysCall, other);
      if (mostRecent < COOLDOWN_MULTI_CHANNEL) {
        return ["none", "none",
          `Cooldown: full press ${mostRecent} bday(s) ago, wait ${COOLDOWN_MULTI_CHANNEL - mostRecent} more bday(s)`];
      }
    }
  }

  // Call cooldown
  const isCallAction = action === "call" || action === "high_value_followup";
  if (isCallAction && daysCall !== null && daysCall < COOLDOWN_CALL) {
    if (daysEmail === null || daysEmail >= COOLDOWN_EMAIL) {
      return ["follow_up_email", priority, `Cooldown: called ${daysCall} bday(s) ago — email instead`];
    }
    return ["none", "none",
      `Cooldown: called ${daysCall} bday(s) ago, emailed ${daysEmail} bday(s) ago — wait`];
  }

  // Email cooldown
  const isEmailAction = action === "follow_up_email" || action === "final_attempt_email";
  if (isEmailAction && daysEmail !== null && daysEmail < COOLDOWN_EMAIL) {
    return ["none", "none",
      `Cooldown: emailed ${daysEmail} bday(s) ago, wait ${COOLDOWN_EMAIL - daysEmail} more bday(s)`];
  }

  return [action, priority, hint];
}

export function enrichLeads(
  leads: ParsedLead[],
  conversations: Record<string, ConversationMeta | null>,
): EnrichedLead[] {
  return leads.map((lead) => {
    const oppFields = enrichFromOpportunity(lead);
    const convo = conversations[lead.contactId] || null;
    const convoFields = enrichFromConversation(convo);

    const enriched: EnrichedLead = {
      ...lead,
      ...oppFields,
      ...convoFields,
    } as EnrichedLead;

    let [action, priority, hint] = decideAction(enriched);
    [action, priority, hint] = applyCooldown(enriched, action, priority, hint);

    enriched.suggestedAction = action;
    enriched.suggestedPriority = priority;
    enriched.hint = hint;

    return enriched;
  });
}
