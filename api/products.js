import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// Domínios permitidos
const ALLOWED_ORIGINS = [
  'https://kzmusicstore.com.br',
  'https://www.kzmusicstore.com.br',
  'https://kzmusicstore.com',
  'https://www.kzmusicstore.com',
  /^https:\/\/[a-z0-9-]+\.myshopify\.com$/,
];

// Chaves Redis por loja
const STORE_KEYS = {
  br: 'kz:recommendations:br',
  global: 'kz:recommendations:global'
};

function isOriginAllowed(origin) {
  if (!origin) return false;
  return ALLOWED_ORIGINS.some(allowed => {
    if (typeof allowed === 'string') return allowed === origin;
    if (allowed instanceof RegExp) return allowed.test(origin);
    return false;
  });
}

function getCorsHeaders(origin) {
  const allowedOrigin = isOriginAllowed(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    // Cache 24h no CDN e browser
    'Cache-Control': 'public, s-maxage=86400, max-age=86400, stale-while-revalidate=604800',
  };
}

export default async function handler(req) {
  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Verifica origem
  if (!isOriginAllowed(origin)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { 
      status: 403, 
      headers: corsHeaders 
    });
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
