import { NextResponse } from "next/server";
import { fetchOpportunities } from "@/lib/ghl/pipeline";
import { fetchAllConversations } from "@/lib/ghl/conversations";
import { enrichLeads } from "@/lib/ghl/enrich";
import { generateRecommendations } from "@/lib/claude/recommendations";
import { writeDashboardData, writeSentStatus } from "@/lib/blob/store";

export const maxDuration = 120;

export async function GET(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    console.log("[cron] Starting pipeline refresh...");

    // 1. Fetch opportunities
    console.log("[cron] Fetching opportunities...");
    const { active, inactiveSummary } = await fetchOpportunities();
    console.log(`[cron] Found ${active.length} active leads`);

    // 2. Fetch conversations for active leads
    console.log("[cron] Fetching conversations...");
    const conversations = await fetchAllConversations(active);
    const withConvos = Object.values(conversations).filter(Boolean).length;
    console.log(`[cron] ${withConvos}/${active.length} contacts have conversations`);

    // 3. Enrich leads
    console.log("[cron] Enriching leads...");
    const enriched = enrichLeads(active, conversations);

    // 4. Generate recommendations via Claude
    console.log("[cron] Generating Claude recommendations...");
    const { actions, noAction } = await generateRecommendations(enriched, inactiveSummary);
    console.log(`[cron] Generated ${actions.length} actions, ${noAction.length} no-action`);

    // 5. Write to Blob
    const dashboardData = {
      actions,
      noAction,
      inactiveSummary,
      generatedAt: new Date().toISOString(),
    };
    await writeDashboardData(dashboardData);

    // 6. Reset sent status for new day
    await writeSentStatus({});

    console.log("[cron] Pipeline refresh complete");
    return NextResponse.json({
      success: true,
      activeLeads: active.length,
      actions: actions.length,
      noAction: noAction.length,
      generatedAt: dashboardData.generatedAt,
    });
  } catch (error) {
    console.error("[cron] Pipeline refresh failed:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 },
    );
  }
}
