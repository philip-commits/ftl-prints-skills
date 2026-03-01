import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    console.log("[refresh] Kicking off pipeline...");
    const pipelineUrl = new URL("/api/pipeline?step=opportunities", request.url);
    const resp = await fetch(pipelineUrl.toString(), { method: "POST" });
    const data = await resp.json();
    console.log("[refresh] Pipeline started:", data);
    return NextResponse.json({ success: true, pipeline: data });
  } catch (error) {
    console.error("[refresh] Failed to start pipeline:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
