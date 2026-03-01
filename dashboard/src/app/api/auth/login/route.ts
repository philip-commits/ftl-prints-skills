import { NextResponse } from "next/server";
import { createSession, getSessionCookieName } from "@/lib/auth/session";

function validateCredentials(username: string, password: string): boolean {
  // Multi-user: DASHBOARD_USERS=phil:pass1,albert:pass2
  const usersEnv = process.env.DASHBOARD_USERS;
  if (usersEnv) {
    return usersEnv.split(",").some((entry) => {
      const [u, p] = entry.split(":");
      return u === username && p === password;
    });
  }
  // Single-user fallback
  return (
    username === process.env.DASHBOARD_USERNAME &&
    password === process.env.DASHBOARD_PASSWORD
  );
}

export async function POST(request: Request) {
  const { username, password } = await request.json();

  if (!process.env.DASHBOARD_USERS && !process.env.DASHBOARD_USERNAME) {
    return NextResponse.json(
      { error: "Auth not configured" },
      { status: 500 },
    );
  }

  if (!validateCredentials(username, password)) {
    return NextResponse.json(
      { error: "Invalid credentials" },
      { status: 401 },
    );
  }

  const token = await createSession();
  const response = NextResponse.json({ success: true });
  response.cookies.set(getSessionCookieName(), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: "/",
  });

  return response;
}
