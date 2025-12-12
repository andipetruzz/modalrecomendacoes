import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  if (req.method !== 'POST') {
    return new Response(null, { status: 405 });
  }

  try {
    const { event, handle, title } = await req.json();
    
    // View do modal de recomendações
    if (event === 'view') {
      await redis.incr('kz:stats:views');
    }
    
    // Clique em "Ver mais detalhes"
    if (event === 'click' && handle) {
      await Promise.all([
        redis.incr('kz:stats:clicks'),
        redis.hincrby('kz:stats:product_clicks', handle, 1),
        redis.hset('kz:stats:product_titles', { [handle]: title || handle }),
      ]);
    }
    
    // Add to cart
    if (event === 'add_to_cart' && handle) {
      await Promise.all([
        redis.incr('kz:stats:add_to_cart'),
        redis.hincrby('kz:stats:product_atc', handle, 1),
        redis.hset('kz:stats:product_titles', { [handle]: title || handle }),
      ]);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export const config = { runtime: 'edge' };
