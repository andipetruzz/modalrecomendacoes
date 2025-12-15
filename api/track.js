import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  if (req.method !== 'POST') {
    return new Response(null, { status: 405 });
  }

  try {
    const { event, handle, title, store } = await req.json();
    const prefix = store === 'global' ? 'kz:stats:global' : 'kz:stats:br';
    
    // View do modal de recomendações
    if (event === 'view') {
      await redis.incr(`${prefix}:views`);
    }
    
    // Clique em "Ver mais detalhes"
    if (event === 'click' && handle) {
      await Promise.all([
        redis.incr(`${prefix}:clicks`),
        redis.hincrby(`${prefix}:product_clicks`, handle, 1),
        redis.hset(`${prefix}:product_titles`, { [handle]: title || handle }),
      ]);
    }
    
    // Add to cart
    if (event === 'add_to_cart' && handle) {
      await Promise.all([
        redis.incr(`${prefix}:add_to_cart`),
        redis.hincrby(`${prefix}:product_atc`, handle, 1),
        redis.hset(`${prefix}:product_titles`, { [handle]: title || handle }),
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
