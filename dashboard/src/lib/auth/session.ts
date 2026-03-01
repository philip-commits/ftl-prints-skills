import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const COOKIE_NAME = "ftl-session";

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET not set");
  return new TextEncoder().encode(secret);
}

export async function createSession(): Promise<string> {
  const token = await new SignJWT({ authenticated: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecret());
  return token;
}

export async function verifySession(): Promise<boolean> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    if (!token) return false;
    await jwtVerify(token, getSecret());
    return true;
  } catch {
    return false;
  }
}

export function getSessionCookieName(): string {
  return COOKIE_NAME;
}
