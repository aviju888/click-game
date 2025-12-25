import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { getClientId } from '@/lib/client-id';

export async function GET(request: NextRequest) {
  try {
    const clientId = await getClientId();

    // Fetch all 3 counter values
    const [counter1, counter2, counter3] = await Promise.all([
      redis.get<number>(`counter:1:value`),
      redis.get<number>(`counter:2:value`),
      redis.get<number>(`counter:3:value`),
    ]);

    const counters: [number, number, number] = [
      counter1 ?? 0,
      counter2 ?? 0,
      counter3 ?? 0,
    ];

    // Calculate team score (sum of all counters)
    const teamScore = counters[0] + counters[1] + counters[2];

    // Get votes used today
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD in UTC
    const votesUsed = await redis.get<number>(`votes:${clientId}:${today}`) ?? 0;
    const votesRemaining = Math.max(0, 3 - votesUsed);

    return NextResponse.json({
      counters,
      teamScore,
      votesRemaining,
    });
  } catch (error) {
    // Error logging without any user data
    console.error('Error fetching counters');
    return NextResponse.json(
      { error: 'Failed to fetch counters' },
      { status: 500 }
    );
  }
}

