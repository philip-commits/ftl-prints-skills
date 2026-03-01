import { NextResponse } from "next/server";
import { fetchOpportunities } from "@/lib/ghl/pipeline";
import { fetchAllConversations } from "@/lib/ghl/conversations";
import { enrichLeads } from "@/lib/ghl/enrich";
import { generateRecommendations } from "@/lib/claude/recommendations";
import { writeDashboardData, writeSentStatus } from "@/lib/blob/store";

export const maxDuration = 120;

export async function POST() {
  try {
    const { active, inactiveSummary } = await fetchOpportunities();
    const conversations = await fetchAllConversations(active);
    const enriched = enrichLeads(active, conversations);
    const { actions, noAction } = await generateRecommendations(enriched, inactiveSummary);

    const dashboardData = {
      actions,
      noAction,
      inactiveSummary,
      generatedAt: new Date().toISOString(),
    };
    await writeDashboardData(dashboardData);
    await writeSentStatus({});

    return NextResponse.json({
      success: true,
      actions: actions.length,
      generatedAt: dashboardData.generatedAt,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
