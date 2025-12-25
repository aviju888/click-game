import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { redis } from '@/lib/redis';

async function checkAdminAuth(): Promise<boolean> {
  const cookieStore = await cookies();
  return cookieStore.get('admin-authenticated')?.value === 'true';
}

export async function GET(request: NextRequest) {
  try {
    // Check admin authentication
    const isAuthenticated = await checkAdminAuth();
    if (!isAuthenticated) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD in UTC
    
    // Get votes per team (all time)
    const votesAllTimeTeamA = await redis.get<number>('stats:team-A-votes') ?? 0;
    const votesAllTimeTeamB = await redis.get<number>('stats:team-B-votes') ?? 0;
    
    // Get votes per team today
    const votesTodayTeamA = await redis.get<number>(`stats:team-A-votes:${today}`) ?? 0;
    const votesTodayTeamB = await redis.get<number>(`stats:team-B-votes:${today}`) ?? 0;
    
    // Calculate vote rate (votes per minute in last hour)
    // We'd need to track timestamps for this, for now return 0
    const voteRate = 0; // TODO: Calculate from recent vote timestamps
    
    // Note: Online count and online per team are handled client-side via Ably Presence
    // They will be updated in the admin stats state from the presence data
    
    return NextResponse.json({
      votesAllTimeTeamA,
      votesAllTimeTeamB,
      votesTodayTeamA,
      votesTodayTeamB,
      voteRate,
    });
  } catch (error) {
    console.error('Error fetching admin stats');
    return NextResponse.json(
      { error: 'Failed to fetch admin stats' },
      { status: 500 }
    );
  }
}

