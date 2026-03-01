import { put, head } from "@vercel/blob";
import type { DashboardData, SentStatus, ParsedLead, ConversationMeta, EnrichedLead } from "../ghl/types";

const DASHBOARD_KEY = "dashboard-data.json";
const SENT_STATUS_KEY = "sent-status.json";
const PIPELINE_STATUS_KEY = "pipeline-status.json";
const PIPELINE_OPPORTUNITIES_KEY = "pipeline-opportunities.json";
const PIPELINE_CONVERSATIONS_KEY = "pipeline-conversations.json";
const PIPELINE_ENRICHED_KEY = "pipeline-enriched.json";

export async function readDashboardData(): Promise<DashboardData | null> {
  try {
    const blob = await head(DASHBOARD_KEY);
    const resp = await fetch(blob.url);
    return (await resp.json()) as DashboardData;
  } catch {
    return null;
  }
}

export async function writeDashboardData(data: DashboardData): Promise<void> {
  await put(DASHBOARD_KEY, JSON.stringify(data), {
    access: "public",
    addRandomSuffix: false,
  });
}

export async function readSentStatus(): Promise<SentStatus> {
  try {
    const blob = await head(SENT_STATUS_KEY);
    const resp = await fetch(blob.url);
    return (await resp.json()) as SentStatus;
  } catch {
    return {};
  }
}

export async function writeSentStatus(status: SentStatus): Promise<void> {
  await put(SENT_STATUS_KEY, JSON.stringify(status), {
    access: "public",
    addRandomSuffix: false,
  });
}

// --- Pipeline step cache ---

export interface PipelineStatus {
  status: "running" | "complete" | "error";
  step: string;
  startedAt: string;
  error?: string;
}

export async function readPipelineStatus(): Promise<PipelineStatus | null> {
  try {
    const blob = await head(PIPELINE_STATUS_KEY);
    const resp = await fetch(blob.url);
    return (await resp.json()) as PipelineStatus;
  } catch {
    return null;
  }
}

export async function writePipelineStatus(status: PipelineStatus): Promise<void> {
  await put(PIPELINE_STATUS_KEY, JSON.stringify(status), {
    access: "public",
    addRandomSuffix: false,
  });
}

export interface PipelineOpportunities {
  active: ParsedLead[];
  inactiveSummary: Record<string, number>;
}

export async function readPipelineOpportunities(): Promise<PipelineOpportunities | null> {
  try {
    const blob = await head(PIPELINE_OPPORTUNITIES_KEY);
    const resp = await fetch(blob.url);
    return (await resp.json()) as PipelineOpportunities;
  } catch {
    return null;
  }
}

export async function writePipelineOpportunities(data: PipelineOpportunities): Promise<void> {
  await put(PIPELINE_OPPORTUNITIES_KEY, JSON.stringify(data), {
    access: "public",
    addRandomSuffix: false,
  });
}

export async function readPipelineConversations(): Promise<Record<string, ConversationMeta | null> | null> {
  try {
    const blob = await head(PIPELINE_CONVERSATIONS_KEY);
    const resp = await fetch(blob.url);
    return (await resp.json()) as Record<string, ConversationMeta | null>;
  } catch {
    return null;
  }
}

export async function writePipelineConversations(data: Record<string, ConversationMeta | null>): Promise<void> {
  await put(PIPELINE_CONVERSATIONS_KEY, JSON.stringify(data), {
    access: "public",
    addRandomSuffix: false,
  });
}

export async function readPipelineEnriched(): Promise<EnrichedLead[] | null> {
  try {
    const blob = await head(PIPELINE_ENRICHED_KEY);
    const resp = await fetch(blob.url);
    return (await resp.json()) as EnrichedLead[];
  } catch {
    return null;
  }
}

export async function writePipelineEnriched(data: EnrichedLead[]): Promise<void> {
  await put(PIPELINE_ENRICHED_KEY, JSON.stringify(data), {
    access: "public",
    addRandomSuffix: false,
  });
}
