import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const VALID_EVENTS = ['view', 'click', 'add_to_cart', 'quiz_start', 'quiz_complete', 'quiz_click', 'quiz_atc'];
const VALID_STORES = ['br', 'global'];

// Domínios permitidos (sem fallback para *)
const ALLOWED_DOMAINS = [
  'kzmusicstore.com.br',
  'www.kzmusicstore.com.br',
  'kzmusicstore.com',
  'www.kzmusicstore.com',
];

function isOriginAllowed(origin) {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return ALLOWED_DOMAINS.includes(url.hostname) || 
           url.hostname.endsWith('.myshopify.com');
  } catch {
    return false;
  }
}

function getCorsHeaders(origin) {
  const allowed = isOriginAllowed(origin);
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowed ? origin : 'https://kzmusicstore.com',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

// Rate limiting: 60 requests por minuto por IP
async function checkRateLimit(ip) {
  const key = `ratelimit:track:${ip}`;
  const current = await redis.incr(key);
  
  // Define TTL de 60 segundos na primeira request
  if (current === 1) {
    await redis.expire(key, 60);
  }
  
  return current <= 60; // Permite até 60 requests por minuto
}

// Extrai IP do request
function getClientIP(req) {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
         req.headers.get('x-real-ip') ||
         req.headers.get('cf-connecting-ip') ||
         'unknown';
}

// Retorna data no formato YYYY-MM-DD
function getDateKey() {
  return new Date().toISOString().split('T')[0];
}

export default async function handler(req) {
  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { 
      status: 405, 
      headers: corsHeaders 
    });
  }

  // Verifica origem
  if (!isOriginAllowed(origin)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { 
      status: 403, 
      headers: corsHeaders 
    });
  }

  // Rate limiting
  const clientIP = getClientIP(req);
  const allowed = await checkRateLimit(clientIP);
  if (!allowed) {
    return new Response(JSON.stringify({ error: 'Too many requests' }), { 
      status: 429, 
      headers: { ...corsHeaders, 'Retry-After': '60' }
    });
  }

  try {
    const body = await req.json();
    const { event, handle, title, store } = body;

    if (!event || !VALID_EVENTS.includes(event)) {
      return new Response(JSON.stringify({ error: 'Invalid event' }), { 
        status: 400, 
        headers: corsHeaders 
      });
    }

    const validStore = VALID_STORES.includes(store) ? store : 'br';
    const prefix = `kz:stats:${validStore}`;
    const dateKey = getDateKey();
    const dailyPrefix = `${prefix}:daily:${dateKey}`;

    const safeHandle = handle ? String(handle).slice(0, 100).replace(/[<>"']/g, '') : null;
    const safeTitle = title ? String(title).slice(0, 200).replace(/[<>"']/g, '') : null;
    
    // View do modal de recomendações
    if (event === 'view') {
      await Promise.all([
        redis.incr(`${prefix}:views`),
        redis.incr(`${dailyPrefix}:views`)
      ]);
    }
    
    // Clique em "Ver mais detalhes"
    if (event === 'click' && safeHandle) {
      await Promise.all([
        redis.incr(`${prefix}:clicks`),
        redis.incr(`${dailyPrefix}:clicks`),
        redis.hincrby(`${prefix}:product_clicks`, safeHandle, 1),
        redis.hincrby(`${dailyPrefix}:product_clicks`, safeHandle, 1),
        redis.hset(`${prefix}:product_titles`, { [safeHandle]: safeTitle || safeHandle }),
      ]);
    }
    
    // Add to cart
    if (event === 'add_to_cart' && safeHandle) {
      await Promise.all([
        redis.incr(`${prefix}:add_to_cart`),
        redis.incr(`${dailyPrefix}:add_to_cart`),
        redis.hincrby(`${prefix}:product_atc`, safeHandle, 1),
        redis.hincrby(`${dailyPrefix}:product_atc`, safeHandle, 1),
        redis.hset(`${prefix}:product_titles`, { [safeHandle]: safeTitle || safeHandle }),
      ]);
    }

    // ==================== QUIZ EVENTS ====================
    
    if (event === 'quiz_start') {
      await Promise.all([
        redis.incr(`${prefix}:quiz:starts`),
        redis.incr(`${dailyPrefix}:quiz:starts`)
      ]);
    }
    
    if (event === 'quiz_complete') {
      await Promise.all([
        redis.incr(`${prefix}:quiz:completions`),
        redis.incr(`${dailyPrefix}:quiz:completions`)
      ]);
    }
    
    if (event === 'quiz_click' && safeHandle) {
      await Promise.all([
        redis.hincrby(`${prefix}:quiz:product_clicks`, safeHandle, 1),
        redis.hincrby(`${dailyPrefix}:quiz:product_clicks`, safeHandle, 1),
        redis.hset(`${prefix}:quiz:product_titles`, { [safeHandle]: safeTitle || safeHandle }),
      ]);
    }
    
    if (event === 'quiz_atc' && safeHandle) {
      await Promise.all([
        redis.hincrby(`${prefix}:quiz:product_atc`, safeHandle, 1),
        redis.hincrby(`${dailyPrefix}:quiz:product_atc`, safeHandle, 1),
        redis.hset(`${prefix}:quiz:product_titles`, { [safeHandle]: safeTitle || safeHandle }),
      ]);
    }

    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
  } catch {
    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
  }
}

export const config = { runtime: 'edge' };
