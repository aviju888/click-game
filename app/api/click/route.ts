import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { redis } from '@/lib/redis';
import { getClientId } from '@/lib/client-id';
import { getOrAssignTeam } from '@/lib/team-assignment';
import { ably, CHANNEL_NAME } from '@/lib/ably';

async function isAdminAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  return cookieStore.get('admin-authenticated')?.value === 'true';
}

function getIPAddress(request: NextRequest): string {
  // Try x-forwarded-for first (for proxies/Vercel)
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const ips = forwarded.split(',');
    return ips[0]?.trim() || '127.0.0.1';
  }

  // Fallback to x-real-ip
  const realIP = request.headers.get('x-real-ip');
  if (realIP) {
    return realIP;
  }

  // Fallback for local development
  return '127.0.0.1';
}

export async function POST(request: NextRequest) {
  try {
    const clientId = await getClientId();
    const ip = getIPAddress(request);

    // Get or assign team
    const team = await getOrAssignTeam(clientId, ip);

    // Validate request has body
    const contentType = request.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      return NextResponse.json(
        { error: 'Content-Type must be application/json' },
        { status: 400 }
      );
    }

    // Parse request body
    let body;
    try {
      body = await request.json();
    } catch (error) {
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    if (!body) {
      return NextResponse.json(
        { error: 'Request body is required' },
        { status: 400 }
      );
    }

    const { counterId, delta } = body;

    // Validate counterId type and value
    if (typeof counterId !== 'number' || !Number.isInteger(counterId)) {
      return NextResponse.json(
        { error: 'counterId must be an integer' },
        { status: 400 }
      );
    }

    if (![1, 2, 3].includes(counterId)) {
      return NextResponse.json(
        { error: 'Invalid counterId. Must be 1, 2, or 3' },
        { status: 400 }
      );
    }

    // Validate delta type and value
    if (typeof delta !== 'number' || !Number.isInteger(delta)) {
      return NextResponse.json(
        { error: 'delta must be an integer' },
        { status: 400 }
      );
    }

    if (delta !== 1 && delta !== -1) {
      return NextResponse.json(
        { error: 'Invalid delta. Must be 1 or -1' },
        { status: 400 }
      );
    }

    // Get current UTC date for vote tracking
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // Check if admin (bypass vote limit)
    const isAdmin = await isAdminAuthenticated();

    let votesRemaining = 0;
    if (!isAdmin) {
      // Track this client ID in a set for potential vote resets
      await redis.sadd(`voters:${today}`, clientId);
      
      // Atomically increment vote count first, then check limit
      // This is more robust than check-then-increment
      const newVoteCount = await redis.incr(`votes:${clientId}:${today}`);
      votesRemaining = 3 - newVoteCount;

      // If limit exceeded after increment, decrement and return error
      if (newVoteCount > 3) {
        await redis.decr(`votes:${clientId}:${today}`);
        return NextResponse.json(
          { error: 'Daily vote limit reached', votesRemaining: 0 },
          { status: 429 }
        );
      }
    } else {
      // Admin: don't track votes, set to unlimited
      votesRemaining = 999;
    }

    // Track total votes ever (for statistics)
    await redis.incr('stats:total-votes');
    
    // Track unique users (add to set)
    await redis.sadd('stats:all-users', clientId);
    
    // Track team membership for stats
    await redis.sadd(`stats:team-${team}-users`, clientId);

    // Atomically increment/decrement the counter
    if (delta === 1) {
      await redis.incr(`counter:${counterId}:value`);
    } else {
      await redis.decr(`counter:${counterId}:value`);
    }

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

    // Calculate team score
    const teamScore = counters[0] + counters[1] + counters[2];

    // Store last vote globally (NO IP ADDRESS - only vote info)
    const lastVote = {
      counterId,
      delta,
      team,
      timestamp: Date.now(),
    };
    await redis.set('last-vote', JSON.stringify(lastVote));

    // Publish update to Ably channel
    try {
      const channel = ably.channels.get(CHANNEL_NAME);
      await channel.publish('update', {
        counters,
        teamScore,
        timestamp: Date.now(),
        lastVote, // Include in real-time update
      });
    } catch (ablyError) {
      // Error logging without IP
      console.error('Error publishing to Ably');
      // Continue even if Ably fails
    }

    return NextResponse.json({
      counters,
      teamScore,
      team,
      votesRemaining,
      success: true,
    });
  } catch (error) {
    // Error logging without any user data
    console.error('Error processing click');
    return NextResponse.json(
      { error: 'Failed to process click' },
      { status: 500 }
    );
  }
}

