import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// Mapeamento de lojas para chaves Redis
const STORE_KEYS = {
  br: 'kz:recommendations:br',
  global: 'kz:recommendations:global'
};

// Migração: Se existir dados antigos, move para :br
async function migrateOldData() {
  const oldData = await redis.get('kz:recommendations');
  if (oldData && Object.keys(oldData).length > 0) {
    const brData = await redis.get('kz:recommendations:br');
    if (!brData || Object.keys(brData).length === 0) {
      await redis.set('kz:recommendations:br', oldData);
      console.log('Migrated old data to :br');
    }
  }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  try {
    // Tenta migrar dados antigos (só executa uma vez efetivamente)
    await migrateOldData();

    const url = new URL(req.url);
    const store = url.searchParams.get('store') || 'br';
    const redisKey = STORE_KEYS[store] || STORE_KEYS.br;
    
    const data = await redis.get(redisKey) || {};

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
