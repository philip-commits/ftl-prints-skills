import { NextResponse } from "next/server";
import { readDashboardData } from "@/lib/blob/store";
import { readSentStatus, writeSentStatus } from "@/lib/blob/store";
import { ghlFetch } from "@/lib/ghl/client";
import { STAGE_IDS } from "@/lib/constants";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  const actionId = parseInt(rawId.split("_")[0], 10);

  const data = await readDashboardData();
  if (!data) {
    return NextResponse.json({ success: false, error: "No dashboard data" }, { status: 404 });
  }

  const action = data.actions.find((a) => a.id === actionId);
  if (!action) {
    return NextResponse.json({ success: false, error: "Action not found" }, { status: 404 });
  }

  const reqBody = await request.json();
  const msgType = reqBody.type || action.messageType || "Email";

  const body: Record<string, string> = {
    type: msgType,
    contactId: action.contactId,
  };

  if (msgType === "Email") {
    body.subject = reqBody.subject || action.subject || "";
    body.html = reqBody.html || "";
    body.message = reqBody.message || action.message || "";
    body.emailFrom = "sales@ftlprints.com";
  } else {
    body.message = reqBody.message || action.message || "";
  }

  try {
    const result = await ghlFetch<{ messageId?: string }>({
      path: "/conversations/messages",
      method: "POST",
      body,
    });

    // Auto-move New Lead → In Progress after first outreach
    if (action.stage === "New Lead" && action.opportunityId) {
      try {
        await ghlFetch({
          path: `/opportunities/${action.opportunityId}`,
          method: "PUT",
          body: { pipelineStageId: STAGE_IDS["In Progress"] },
        });
      } catch {
        // Non-fatal — message was sent, stage move can be done manually
      }
    }

    const sent = await readSentStatus();
    sent[rawId] = { status: "sent", ts: Date.now() };
    await writeSentStatus(sent);

    return NextResponse.json({ success: true, messageId: result.messageId || "" });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
