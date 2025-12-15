import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// Domínios permitidos (suas lojas)
const ALLOWED_ORIGINS = [
  'https://kzmusicstore.com.br',
  'https://www.kzmusicstore.com.br',
  'https://kzmusicstore.com',
  'https://www.kzmusicstore.com',
  // Preview do Shopify (para testes no tema)
  /^https:\/\/[a-z0-9-]+\.myshopify\.com$/,
];

// Eventos válidos
const VALID_EVENTS = ['view', 'click', 'add_to_cart', 'quiz_start', 'quiz_complete', 'quiz_click', 'quiz_atc'];

// Lojas válidas
const VALID_STORES = ['br', 'global'];

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
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export default async function handler(req) {
  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Só aceita POST
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

  try {
    const body = await req.json();
    const { event, handle, title, store } = body;

    // Valida evento
    if (!event || !VALID_EVENTS.includes(event)) {
      return new Response(JSON.stringify({ error: 'Invalid event' }), { 
        status: 400, 
        headers: corsHeaders 
      });
    }

    // Valida store
    const validStore = VALID_STORES.includes(store) ? store : 'br';
    const prefix = validStore === 'global' ? 'kz:stats:global' : 'kz:stats:br';

    // Sanitiza handle e title (remove caracteres perigosos, limita tamanho)
    const safeHandle = handle ? String(handle).slice(0, 100).replace(/[<>"']/g, '') : null;
    const safeTitle = title ? String(title).slice(0, 200).replace(/[<>"']/g, '') : null;
    
    // View do modal de recomendações
    if (event === 'view') {
      await redis.incr(`${prefix}:views`);
    }
    
    // Clique em "Ver mais detalhes"
    if (event === 'click' && safeHandle) {
      await Promise.all([
        redis.incr(`${prefix}:clicks`),
        redis.hincrby(`${prefix}:product_clicks`, safeHandle, 1),
        redis.hset(`${prefix}:product_titles`, { [safeHandle]: safeTitle || safeHandle }),
      ]);
    }
    
    // Add to cart
    if (event === 'add_to_cart' && safeHandle) {
      await Promise.all([
        redis.incr(`${prefix}:add_to_cart`),
        redis.hincrby(`${prefix}:product_atc`, safeHandle, 1),
        redis.hset(`${prefix}:product_titles`, { [safeHandle]: safeTitle || safeHandle }),
      ]);
    }

    // ==================== QUIZ EVENTS ====================
    
    // Quiz iniciado
    if (event === 'quiz_start') {
      await redis.incr(`${prefix}:quiz:starts`);
    }
    
    // Quiz completado
    if (event === 'quiz_complete') {
      await redis.incr(`${prefix}:quiz:completions`);
    }
    
    // Clique em produto do quiz (Ver Detalhes)
    if (event === 'quiz_click' && safeHandle) {
      await Promise.all([
        redis.hincrby(`${prefix}:quiz:product_clicks`, safeHandle, 1),
        redis.hset(`${prefix}:quiz:product_titles`, { [safeHandle]: safeTitle || safeHandle }),
      ]);
    }
    
    // Add to cart do quiz
    if (event === 'quiz_atc' && safeHandle) {
      await Promise.all([
        redis.hincrby(`${prefix}:quiz:product_atc`, safeHandle, 1),
        redis.hset(`${prefix}:quiz:product_titles`, { [safeHandle]: safeTitle || safeHandle }),
      ]);
    }

    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
  } catch {
    // Falha silenciosa para não afetar a experiência do usuário
    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
  }
}

export const config = { runtime: 'edge' };
