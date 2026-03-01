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
  readPipelineRecommendations,
  writePipelineRecommendations,
} from "@/lib/blob/store";

export const maxDuration = 300;

const CONVO_BATCH_SIZE = 5;
const RECOMMEND_BATCH_SIZE = 8;

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
      const done = nextOffset >= total;
      if (done) {
        const withConvos = Object.values(merged).filter(Boolean).length;
        console.log(`[pipeline:conversations] Done: ${withConvos}/${total} have conversations`);
      }

      return NextResponse.json({
        success: true,
        step: "conversations",
        offset,
        batchSize: batch.length,
        total,
        done,
        nextOffset: done ? null : nextOffset,
      });
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
    const offset = parseInt(searchParams.get("offset") || "0", 10);
    try {
      const oppData = await readPipelineOpportunities();
      const enriched = await readPipelineEnriched();
      if (!oppData || !enriched) throw new Error("Missing opportunity or enriched data");

      const total = enriched.length;
      const batch = enriched.slice(offset, offset + RECOMMEND_BATCH_SIZE);

      await writePipelineStatus({
        status: "running",
        step: "recommend",
        startedAt: new Date().toISOString(),
      });

      console.log(`[pipeline:recommend] Batch ${offset}–${offset + batch.length} of ${total}`);
      const { actions, noAction } = await generateRecommendations(batch, oppData.inactiveSummary);

      // Merge with previous batches
      const existing = offset > 0 ? (await readPipelineRecommendations()) || { actions: [], noAction: [] } : { actions: [], noAction: [] };
      const mergedActions = [...existing.actions, ...actions];
      const mergedNoAction = [...existing.noAction, ...noAction];

      // Re-number action IDs sequentially
      mergedActions.forEach((a, i) => { a.id = i + 1; });

      const nextOffset = offset + RECOMMEND_BATCH_SIZE;
      const done = nextOffset >= total;

      if (done) {
        // Final batch — write dashboard data
        console.log(`[pipeline:recommend] Done: ${mergedActions.length} actions, ${mergedNoAction.length} no-action`);
        const dashboardData = {
          actions: mergedActions,
          noAction: mergedNoAction,
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
      } else {
        // Save partial results
        await writePipelineRecommendations({ actions: mergedActions, noAction: mergedNoAction });
      }

      return NextResponse.json({
        success: true,
        step: "recommend",
        offset,
        batchSize: batch.length,
        total,
        done,
        nextOffset: done ? null : nextOffset,
      });
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
