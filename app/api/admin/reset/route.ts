import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { redis } from '@/lib/redis';

// ADMIN_PASSWORD is validated in auth route, not needed here

async function checkAdminAuth(): Promise<boolean> {
  const cookieStore = await cookies();
  return cookieStore.get('admin-authenticated')?.value === 'true';
}

export async function POST(request: NextRequest) {
  try {
    // Check admin authentication
    const isAuthenticated = await checkAdminAuth();
    if (!isAuthenticated) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Validate request has body
    const contentType = request.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      return NextResponse.json(
        { error: 'Content-Type must be application/json' },
        { status: 400 }
      );
    }

    let body;
    try {
      body = await request.json();
    } catch (error) {
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    // Validate type is a string
    if (!body || typeof body.type !== 'string') {
      return NextResponse.json(
        { error: 'Type is required and must be a string' },
        { status: 400 }
      );
    }

    const { type } = body;

    if (type === 'counters') {
      // Reset all counters to 0
      await Promise.all([
        redis.set('counter:1:value', 0),
        redis.set('counter:2:value', 0),
        redis.set('counter:3:value', 0),
      ]);

      // Publish update
      const { ably, CHANNEL_NAME } = await import('@/lib/ably');
      try {
        const channel = ably.channels.get(CHANNEL_NAME);
        await channel.publish('update', {
          counters: [0, 0, 0],
          teamScore: 0,
          timestamp: Date.now(),
        });
      } catch (error) {
        // Error logging without any user data
        console.error('Error publishing reset');
      }

      return NextResponse.json({ success: true, message: 'All counters reset' });
    }

    if (type === 'votes') {
      // Reset all vote limits for today (give everyone their 3 votes back)
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      try {
        // Get all client IDs that have voted today
        const voterSetKey = `voters:${today}`;
        const clientIds = await redis.smembers<string[]>(voterSetKey) ?? [];
        
        // Delete vote counts for all clients in the set
        const deletePromises: Promise<number>[] = [];
        if (clientIds.length > 0) {
          clientIds.forEach(clientId => {
            deletePromises.push(redis.del(`votes:${clientId}:${today}`));
          });
          await Promise.all(deletePromises);
        }
        
        // Clear the voters set (this ensures no one is tracked as having voted)
        await redis.del(voterSetKey);
        
        // Wait a moment to ensure Redis operations complete and propagate
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Publish update to notify all clients to refresh their vote counts
        const { ably, CHANNEL_NAME } = await import('@/lib/ably');
        try {
          const channel = ably.channels.get(CHANNEL_NAME);
          const [counter1, counter2, counter3] = await Promise.all([
            redis.get<number>('counter:1:value'),
            redis.get<number>('counter:2:value'),
            redis.get<number>('counter:3:value'),
          ]);
          const counters: [number, number, number] = [
            counter1 ?? 0,
            counter2 ?? 0,
            counter3 ?? 0,
          ];
          const teamScore = counters[0] + counters[1] + counters[2];
          
          await channel.publish('update', {
            counters,
            teamScore,
            timestamp: Date.now(),
            voteReset: true, // Signal that votes were reset
          });
        } catch (error) {
          // Error logging without any user data
          console.error('Error publishing vote reset');
        }
      } catch (error) {
        // Error logging without any user data
        console.error('Error resetting votes');
        return NextResponse.json(
          { error: 'Failed to reset votes' },
          { status: 500 }
        );
      }

      return NextResponse.json({ 
        success: true, 
        message: 'All vote limits reset - everyone has 3 votes again' 
      });
    }

    if (type === 'all') {
      // Reset all counters
      await Promise.all([
        redis.set('counter:1:value', 0),
        redis.set('counter:2:value', 0),
        redis.set('counter:3:value', 0),
      ]);
      
      // Reset total votes count (accounting for resets)
      await redis.set('stats:total-votes', 0);

      // Reset all vote limits for today
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      try {
        // Get all client IDs that have voted today
        const voterSetKey = `voters:${today}`;
        const clientIds = await redis.smembers<string[]>(voterSetKey);
        
        if (clientIds && clientIds.length > 0) {
          // Delete vote counts for all clients
          const deletePromises = clientIds.map(clientId => 
            redis.del(`votes:${clientId}:${today}`)
          );
          await Promise.all(deletePromises);
        }
        
        // Clear the voters set
        await redis.del(voterSetKey);
      } catch (error) {
        // Error logging without any user data
        console.error('Error resetting votes');
        // Continue even if vote reset fails
      }

      // Publish update
      const { ably, CHANNEL_NAME } = await import('@/lib/ably');
      try {
        const channel = ably.channels.get(CHANNEL_NAME);
        await channel.publish('update', {
          counters: [0, 0, 0],
          teamScore: 0,
          timestamp: Date.now(),
        });
      } catch (error) {
        // Error logging without any user data
        console.error('Error publishing reset');
      }

      return NextResponse.json({ success: true, message: 'Everything reset (counters and all vote limits)' });
    }

    return NextResponse.json(
      { error: 'Invalid reset type' },
      { status: 400 }
    );
  } catch (error) {
    // Error logging without any user data
    console.error('Error resetting');
    return NextResponse.json(
      { error: 'Failed to reset' },
      { status: 500 }
    );
  }
}

