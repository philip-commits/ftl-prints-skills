import { NextResponse } from "next/server";

export const maxDuration = 300;

export async function GET(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const baseUrl = new URL(request.url).origin;

  try {
    console.log("[cron] Starting pipeline...");

    // Step 1: Opportunities
    const oppResp = await fetch(`${baseUrl}/api/pipeline?step=opportunities`, { method: "POST" });
    const oppData = await oppResp.json();
    if (!oppResp.ok) throw new Error(`opportunities failed: ${oppData.error}`);
    console.log(`[cron] Opportunities: ${oppData.activeLeads} active leads`);

    // Step 2: Conversations (batched)
    let offset = 0;
    let convoDone = false;
    while (!convoDone) {
      const convoResp = await fetch(`${baseUrl}/api/pipeline?step=conversations&offset=${offset}`);
      const convoData = await convoResp.json();
      if (!convoResp.ok) throw new Error(`conversations failed: ${convoData.error}`);
      console.log(`[cron] Conversations batch ${offset}: ${convoData.batchSize} contacts`);
      convoDone = convoData.done;
      offset = convoData.nextOffset ?? offset;
    }

    // Step 3: Enrich
    const enrichResp = await fetch(`${baseUrl}/api/pipeline?step=enrich`);
    const enrichData = await enrichResp.json();
    if (!enrichResp.ok) throw new Error(`enrich failed: ${enrichData.error}`);
    console.log("[cron] Enrichment complete");

    // Step 4: Recommend (batched)
    let recOffset = 0;
    let recDone = false;
    while (!recDone) {
      const recResp = await fetch(`${baseUrl}/api/pipeline?step=recommend&offset=${recOffset}`);
      const recData = await recResp.json();
      if (!recResp.ok) throw new Error(`recommend failed: ${recData.error}`);
      console.log(`[cron] Recommend batch ${recOffset}: ${recData.batchSize} leads`);
      recDone = recData.done;
      recOffset = recData.nextOffset ?? recOffset;
    }
    console.log("[cron] Recommendations complete");

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[cron] Pipeline failed:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
