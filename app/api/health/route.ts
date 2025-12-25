import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { ably } from '@/lib/ably';

export async function GET(request: NextRequest) {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      redis: 'unknown',
      ably: 'unknown',
    },
  };

  // Check Redis connectivity
  try {
    // Try a simple get operation to verify connectivity
    await redis.get('health-check');
    health.services.redis = 'healthy';
  } catch (error) {
    health.services.redis = 'unhealthy';
    health.status = 'degraded';
  }

  // Check Ably connectivity (basic check - just verify it's initialized)
  try {
    if (ably && ably.channels) {
      health.services.ably = 'healthy';
    } else {
      health.services.ably = 'unhealthy';
      health.status = 'degraded';
    }
  } catch (error) {
    health.services.ably = 'unhealthy';
    health.status = 'degraded';
  }

  const statusCode = health.status === 'healthy' ? 200 : 503;

  return NextResponse.json(health, { status: statusCode });
}

