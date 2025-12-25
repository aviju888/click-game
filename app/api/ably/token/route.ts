import { NextRequest, NextResponse } from 'next/server';
import Ably from 'ably';

if (!process.env.ABLY_API_KEY) {
  throw new Error('ABLY_API_KEY is not set');
}

const ably = new Ably.Rest({
  key: process.env.ABLY_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    const tokenRequest = await ably.auth.createTokenRequest({
      clientId: `client-${Date.now()}-${Math.random()}`,
    });

    return NextResponse.json(tokenRequest);
  } catch (error) {
    console.error('Error creating Ably token:', error);
    return NextResponse.json(
      { error: 'Failed to create token' },
      { status: 500 }
    );
  }
}

