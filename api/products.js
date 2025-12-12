import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  try {
    const data = await redis.get('kz:recommendations') || {};

    return new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        // Cache 24h no CDN e browser
        'Cache-Control': 'public, s-maxage=86400, max-age=86400, stale-while-revalidate=604800',
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export const config = { runtime: 'edge' };
