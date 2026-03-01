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

const CONVO_BATCH_SIZE = 5;

function chainNext(request: Request, step: string, extraParams?: Record<string, string>) {
  const url = new URL(request.url);
  url.searchParams.set("step", step);
  if (extraParams) {
    for (const [k, v] of Object.entries(extraParams)) {
      url.searchParams.set(k, v);
    }
  }
  fetch(url.toString(), { signal: AbortSignal.timeout(500) }).catch(() => {});
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
    const offset = parseInt(searchParams.get("offset") || "0", 10);
    try {
      const oppData = await readPipelineOpportunities();
      if (!oppData) throw new Error("No opportunity data found in blob");

      const total = oppData.active.length;
      const batch = oppData.active.slice(offset, offset + CONVO_BATCH_SIZE);

      await writePipelineStatus({
        status: "running",
        step: "conversations",
        startedAt: new Date().toISOString(),
      });

      console.log(`[pipeline:conversations] Batch ${offset}–${offset + batch.length} of ${total}`);
      const batchResults = await fetchAllConversations(batch);

      // Merge with previous batches
      const existing = offset > 0 ? (await readPipelineConversations()) || {} : {};
      const merged = { ...existing, ...batchResults };
      await writePipelineConversations(merged);

      const nextOffset = offset + CONVO_BATCH_SIZE;
      if (nextOffset < total) {
        // Chain next batch
        chainNext(request, "conversations", { offset: String(nextOffset) });
      } else {
        // All done, chain enrich
        const withConvos = Object.values(merged).filter(Boolean).length;
        console.log(`[pipeline:conversations] Done: ${withConvos}/${total} have conversations`);
        chainNext(request, "enrich");
      }

      return NextResponse.json({ success: true, step: "conversations", offset, batchSize: batch.length, total });
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
