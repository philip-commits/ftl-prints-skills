import { NextResponse } from "next/server";
import { fetchOpportunities } from "@/lib/ghl/pipeline";
import { fetchAllConversations } from "@/lib/ghl/conversations";
import { enrichLeads } from "@/lib/ghl/enrich";
import { generateRecommendations } from "@/lib/claude/recommendations";
import {
  writeDashboardData,
  writeSentStatus,
  readPipelineStatus,
  writePipelineStatus,
  writePipelineOpportunities,
  readPipelineOpportunities,
  writePipelineConversations,
  readPipelineConversations,
  writePipelineEnriched,
  readPipelineEnriched,
} from "@/lib/blob/store";

export const maxDuration = 60;

function selfUrl(request: Request, step: string): string {
  const url = new URL(request.url);
  url.searchParams.set("step", step);
  return url.toString();
}

function chainNext(request: Request, step: string) {
  const url = selfUrl(request, step);
  fetch(url, { signal: AbortSignal.timeout(500) }).catch(() => {});
}

// --- GET: status, conversations, enrich, recommend ---
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const step = searchParams.get("step");

  if (step === "status") {
    const status = await readPipelineStatus();
    return NextResponse.json(status || { status: "idle", step: "none" });
  }

  if (step === "conversations") {
    try {
      await writePipelineStatus({
        status: "running",
        step: "conversations",
        startedAt: new Date().toISOString(),
      });

      const oppData = await readPipelineOpportunities();
      if (!oppData) throw new Error("No opportunity data found in blob");

      console.log(`[pipeline:conversations] Fetching convos for ${oppData.active.length} contacts...`);
      const conversations = await fetchAllConversations(oppData.active);
      const withConvos = Object.values(conversations).filter(Boolean).length;
      console.log(`[pipeline:conversations] ${withConvos}/${oppData.active.length} have conversations`);

      await writePipelineConversations(conversations);
      chainNext(request, "enrich");
      return NextResponse.json({ success: true, step: "conversations" });
    } catch (error) {
      console.error("[pipeline:conversations]", error);
      await writePipelineStatus({
        status: "error",
        step: "conversations",
        startedAt: new Date().toISOString(),
        error: String(error),
      });
      return NextResponse.json({ error: String(error) }, { status: 500 });
    }
  }

  if (step === "enrich") {
    try {
      await writePipelineStatus({
        status: "running",
        step: "enrich",
        startedAt: new Date().toISOString(),
      });

      const oppData = await readPipelineOpportunities();
      const convos = await readPipelineConversations();
      if (!oppData || !convos) throw new Error("Missing opportunity or conversation data");

      console.log("[pipeline:enrich] Enriching leads...");
      const enriched = enrichLeads(oppData.active, convos);

      await writePipelineEnriched(enriched);
      chainNext(request, "recommend");
      return NextResponse.json({ success: true, step: "enrich" });
    } catch (error) {
      console.error("[pipeline:enrich]", error);
      await writePipelineStatus({
        status: "error",
        step: "enrich",
        startedAt: new Date().toISOString(),
        error: String(error),
      });
      return NextResponse.json({ error: String(error) }, { status: 500 });
    }
  }

  if (step === "recommend") {
    try {
      await writePipelineStatus({
        status: "running",
        step: "recommend",
        startedAt: new Date().toISOString(),
      });

      const oppData = await readPipelineOpportunities();
      const enriched = await readPipelineEnriched();
      if (!oppData || !enriched) throw new Error("Missing opportunity or enriched data");

      console.log("[pipeline:recommend] Generating Claude recommendations...");
      const { actions, noAction } = await generateRecommendations(enriched, oppData.inactiveSummary);
      console.log(`[pipeline:recommend] ${actions.length} actions, ${noAction.length} no-action`);

      const dashboardData = {
        actions,
        noAction,
        inactiveSummary: oppData.inactiveSummary,
        generatedAt: new Date().toISOString(),
      };
      await writeDashboardData(dashboardData);
      await writeSentStatus({});

      await writePipelineStatus({
        status: "complete",
        step: "recommend",
        startedAt: new Date().toISOString(),
      });

      return NextResponse.json({ success: true, step: "recommend" });
    } catch (error) {
      console.error("[pipeline:recommend]", error);
      await writePipelineStatus({
        status: "error",
        step: "recommend",
        startedAt: new Date().toISOString(),
        error: String(error),
      });
      return NextResponse.json({ error: String(error) }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "Unknown step" }, { status: 400 });
}

// --- POST: opportunities (entry point) ---
export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const step = searchParams.get("step") || "opportunities";

  if (step === "opportunities") {
    try {
      await writePipelineStatus({
        status: "running",
        step: "opportunities",
        startedAt: new Date().toISOString(),
      });

      console.log("[pipeline:opportunities] Fetching opportunities...");
      const { active, inactiveSummary } = await fetchOpportunities();
      console.log(`[pipeline:opportunities] Found ${active.length} active leads`);

      await writePipelineOpportunities({ active, inactiveSummary });
      chainNext(request, "conversations");
      return NextResponse.json({ success: true, step: "opportunities", activeLeads: active.length });
    } catch (error) {
      console.error("[pipeline:opportunities]", error);
      await writePipelineStatus({
        status: "error",
        step: "opportunities",
        startedAt: new Date().toISOString(),
        error: String(error),
      });
      return NextResponse.json({ error: String(error) }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "Unknown step" }, { status: 400 });
}
