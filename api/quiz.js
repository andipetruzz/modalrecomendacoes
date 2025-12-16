import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// Chaves Redis por loja
const STORE_KEYS = {
  br: 'kz:quiz:br',
  global: 'kz:quiz:global'
};

function getCorsHeaders(origin) {
  // Aceita qualquer origem das lojas KZ
  const allowed = origin && (
    origin.includes('kzmusicstore.com') || 
    origin.includes('myshopify.com') ||
    origin.includes('localhost')
  );
  
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowed ? origin : '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'public, s-maxage=3600, max-age=3600, stale-while-revalidate=86400',
  };
}

export default async function handler(req) {
  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const store = url.searchParams.get('store') || 'br';
    const redisKey = STORE_KEYS[store] || STORE_KEYS.br;
    
    const data = await redis.get(redisKey) || {};

    return new Response(JSON.stringify(data), { headers: corsHeaders });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: corsHeaders,
    });
  }
}

export const config = { runtime: 'edge' };
