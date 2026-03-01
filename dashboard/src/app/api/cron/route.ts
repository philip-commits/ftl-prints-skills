import { NextResponse } from "next/server";

export async function GET(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    console.log("[cron] Kicking off pipeline...");
    const pipelineUrl = new URL("/api/pipeline?step=opportunities", request.url);
    const resp = await fetch(pipelineUrl.toString(), { method: "POST" });
    const data = await resp.json();
    console.log("[cron] Pipeline started:", data);
    return NextResponse.json({ success: true, pipeline: data });
  } catch (error) {
    console.error("[cron] Failed to start pipeline:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
