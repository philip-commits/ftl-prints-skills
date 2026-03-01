import { NextResponse } from "next/server";
import { readSentStatus, writeSentStatus } from "@/lib/blob/store";

export async function GET() {
  const status = await readSentStatus();
  return NextResponse.json(status);
}

export async function POST(request: Request) {
  const body = await request.json();
  const current = await readSentStatus();
  const updated = { ...current, ...body };
  await writeSentStatus(updated);
  return NextResponse.json({ success: true });
}
