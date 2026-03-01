import Anthropic from "@anthropic-ai/sdk";
import type { EnrichedLead, ActionItem, NoActionItem } from "../ghl/types";

const client = new Anthropic();

const SYSTEM_PROMPT = `You are an operations assistant for Fort Lauderdale Screen Printing (FTL Prints). You generate daily action items for Philip Munroe, the founder.

For each lead you'll receive enriched pipeline data including conversation history, notes, suggested actions from an automated decision tree, and contact details.

Your job:
1. Review the automated suggestedAction and hint for each lead
2. Override if conversation context warrants it (e.g., lead said "back next week", project is out of scope)
3. Generate actionable items with drafted messages

For each action item, output:
- actionType: reply | outreach | call | follow_up_email | move | none
- priority: high | medium | info
- label: Short description of what to do
- context: ~250 char summary grounded in conversation history. Reference specific prices, products, what was discussed. Never generic.
- recommendation: ~150 char specific next step for Philip
- For email actions: subject + message (3-5 sentences, professional but warm, South Florida casual, sign as "Philip" or "The FTL Prints Team" for first contact)
- For SMS actions: smsMessage (under 160 chars, casual, reference specific details, sign as "—Phil")
- For call actions: noAnswerSms + noAnswerSubject + noAnswerEmail (pre-written follow-ups if no answer)
- For move actions: targetStageId (usually Cooled Off: 7ec748b8-920d-4bdb-bf09-74dd22d27846)

Rules:
- NEVER offer to adjust/reduce/discount pricing
- Every follow-up must reference a specific conversation detail
- International contacts: email only (no SMS/call)
- Ground emails in conversation history: prices, specs, quantities, turnaround, what customer last said
- Ask for exactly what's missing, don't be vague
- Leads contacted today with no response → noAction
- Every lead must appear in either actions or noAction

Stage IDs for moves:
- Cooled Off: 7ec748b8-920d-4bdb-bf09-74dd22d27846
- Unqualified: b909061c-9141-45d7-b1e2-fd37432c3596
- Sale: 1ab155c2-282d-45eb-bd43-1052489eb2a1

Output valid JSON matching this schema:
{
  "actions": [ActionItem...],
  "noAction": [NoActionItem...]
}`;

export async function generateRecommendations(
  leads: EnrichedLead[],
  inactiveSummary: Record<string, number>,
): Promise<{ actions: ActionItem[]; noAction: NoActionItem[] }> {
  const leadsData = leads.map((lead) => ({
    contactId: lead.contactId,
    contactName: lead.name,
    contactEmail: lead.email,
    contactPhone: lead.phone,
    opportunityId: lead.id,
    stage: lead.stage,
    stageId: lead.stageId,
    monetaryValue: lead.monetaryValue,
    days_created: lead.days_created,
    days_in_stage: lead.days_in_stage,
    service_type: lead.service_type,
    budget: lead.budget,
    quantity: lead.quantity,
    sizes: lead.sizes,
    project_details: lead.project_details,
    hasArtwork: lead.hasArtwork,
    isInternational: lead.isInternational,
    missingInfo: lead.missingInfo,
    needsReply: lead.needsReply,
    hasManualOutreach: lead.hasManualOutreach,
    daysSinceLastContact: lead.daysSinceLastContact,
    outboundCount: lead.outboundCount,
    noConversation: lead.noConversation,
    suggestedAction: lead.suggestedAction,
    suggestedPriority: lead.suggestedPriority,
    hint: lead.hint,
    conversationHistory: lead.conversationHistory,
    notes: lead.notes,
  }));

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 16384,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Here are today's ${leads.length} active leads. Generate action items for each.

Inactive summary: ${JSON.stringify(inactiveSummary)}

Leads:
${JSON.stringify(leadsData, null, 2)}

Return valid JSON with "actions" and "noAction" arrays. Action IDs must be sequential starting at 1. For each action, only include contactId as the identifier — do NOT include contactName, contactEmail, contactPhone, opportunityId, stage, conversationHistory, or notes. Those fields will be attached automatically.`,
      },
    ],
  });

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  // Extract JSON from response (may be wrapped in markdown code blocks)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Claude response did not contain valid JSON");
  }

  const result = JSON.parse(jsonMatch[0]) as {
    actions: ActionItem[];
    noAction: NoActionItem[];
  };

  // Reattach contact metadata, conversation history, and notes from enriched data
  for (const action of result.actions) {
    const lead = leads.find((l) => l.contactId === action.contactId);
    if (lead) {
      action.contactName = lead.name;
      action.contactEmail = lead.email;
      action.contactPhone = lead.phone;
      action.opportunityId = lead.id;
      action.stage = lead.stage;
      action.conversationHistory = lead.conversationHistory;
      action.notes = lead.notes;
      action.international = lead.isInternational;
    }
  }

  return result;
}
