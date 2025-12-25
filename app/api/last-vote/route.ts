import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';

export async function GET(request: NextRequest) {
  try {
    const lastVoteJson = await redis.get<string>('last-vote');
    
    if (!lastVoteJson) {
      return NextResponse.json({ lastVote: null });
    }

    const lastVote = JSON.parse(lastVoteJson);
    
    // Return only vote info - NO IP, NO client ID
    return NextResponse.json({
      lastVote: {
        counterId: lastVote.counterId,
        delta: lastVote.delta,
        team: lastVote.team,
        timestamp: lastVote.timestamp,
      },
    });
  } catch (error) {
    // Error logging without any user data
    console.error('Error fetching last vote');
    return NextResponse.json(
      { error: 'Failed to fetch last vote' },
      { status: 500 }
    );
  }
}

