import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "cv_session";
export const SESSION_DURATION_S = 60 * 60 * 24 * 30; // 30 days

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signSessionToken(secret: string): Promise<string> {
  return new SignJWT({ sub: "owner" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_S}s`)
    .sign(secretKey(secret));
}

export async function verifySessionToken(
  token: string | undefined,
  secret: string
): Promise<boolean> {
  if (!token) return false;
  try {
    await jwtVerify(token, secretKey(secret));
    return true;
  } catch {
    return false;
  }
}
