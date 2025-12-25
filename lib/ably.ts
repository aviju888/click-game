import Ably from 'ably';

if (!process.env.ABLY_API_KEY) {
  throw new Error('ABLY_API_KEY is not set');
}

export const ably = new Ably.Rest({
  key: process.env.ABLY_API_KEY,
});

export const CHANNEL_NAME = 'global-counter';

