import { NextResponse } from "next/server";
import { createSession, getSessionCookieName } from "@/lib/auth/session";

export async function POST(request: Request) {
  const { username, password } = await request.json();

  const validUser = process.env.DASHBOARD_USERNAME;
  const validPass = process.env.DASHBOARD_PASSWORD;

  if (!validUser || !validPass) {
    return NextResponse.json(
      { error: "Auth not configured" },
      { status: 500 },
    );
  }

  if (username !== validUser || password !== validPass) {
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
