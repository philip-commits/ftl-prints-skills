import { NextResponse } from "next/server";
import { readSentStatus, writeSentStatus } from "@/lib/blob/store";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const sent = await readSentStatus();
  sent[id] = { status: "dismissed", ts: Date.now() };
  await writeSentStatus(sent);

  return NextResponse.json({ success: true });
}
