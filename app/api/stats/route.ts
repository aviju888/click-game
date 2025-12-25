import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';

export async function GET(request: NextRequest) {
  try {
    // Get total votes ever
    const totalVotes = await redis.get<number>('stats:total-votes') ?? 0;
    
    // Get total unique users
    const allUsers = await redis.smembers<string[]>('stats:all-users') ?? [];
    const totalUsers = allUsers.length;
    
    // Get users per team
    const teamAUsers = await redis.smembers<string[]>('stats:team-A-users') ?? [];
    const teamBUsers = await redis.smembers<string[]>('stats:team-B-users') ?? [];
    
    return NextResponse.json({
      totalVotes,
      totalUsers,
      teamAUsers: teamAUsers.length,
      teamBUsers: teamBUsers.length,
    });
  } catch (error) {
    // Error logging without any user data
    console.error('Error fetching stats');
    return NextResponse.json(
      { error: 'Failed to fetch stats' },
      { status: 500 }
    );
  }
}

