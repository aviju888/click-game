import { cookies } from 'next/headers';
import { v4 as uuidv4 } from 'uuid';

const COOKIE_NAME = 'cid';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

export async function getClientId(): Promise<string> {
  const cookieStore = await cookies();
  const existingId = cookieStore.get(COOKIE_NAME);

  if (existingId?.value) {
    return existingId.value;
  }

  // Generate new client ID
  const newId = uuidv4();
  cookieStore.set(COOKIE_NAME, newId, {
    maxAge: COOKIE_MAX_AGE,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });

  return newId;
}

export function getClientIdFromRequest(request: Request): string | null {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
    const [key, value] = cookie.trim().split('=');
    acc[key] = value;
    return acc;
  }, {} as Record<string, string>);

  return cookies[COOKIE_NAME] || null;
}

