import { GHL_BASE, GHL_API_VERSION, USER_AGENT, MAX_CONCURRENT } from "../constants";
import { getAccessToken } from "./auth";

// Simple semaphore for rate limiting
let activeRequests = 0;
const queue: Array<() => void> = [];

function acquireSemaphore(): Promise<void> {
  return new Promise((resolve) => {
    if (activeRequests < MAX_CONCURRENT) {
      activeRequests++;
      resolve();
    } else {
      queue.push(() => {
        activeRequests++;
        resolve();
      });
    }
  });
}

function releaseSemaphore(): void {
  activeRequests--;
  const next = queue.shift();
  if (next) next();
}

interface GHLRequestOptions {
  path: string;
  method?: string;
  body?: unknown;
  retries?: number;
}

export async function ghlFetch<T>(options: GHLRequestOptions): Promise<T> {
  const { path, method = "GET", body, retries = 1 } = options;
  const token = await getAccessToken();

  await acquireSemaphore();
  try {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const resp = await fetch(`${GHL_BASE}${path}`, {
        method,
        headers: {
          Authorization: token,
          Version: GHL_API_VERSION,
          "Content-Type": "application/json",
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });

      if (resp.ok) {
        return (await resp.json()) as T;
      }

      if ((resp.status === 500 || resp.status === 503) && attempt < retries) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      throw new Error(`GHL API ${resp.status}: ${await resp.text()}`);
    }

    throw new Error("GHL API request failed after retries");
  } finally {
    releaseSemaphore();
  }
}

export async function runConcurrent<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  return Promise.all(items.map(fn));
}
