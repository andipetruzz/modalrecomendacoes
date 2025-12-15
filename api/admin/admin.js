import { Redis } from '@upstash/redis';

// DEBUG: Log env vars
console.log('ENV CHECK:', {
  hasKvUrl: !!process.env.KV_REST_API_URL,
  hasKvToken: !!process.env.KV_REST_API_TOKEN,
  hasShopifyStoreBR: !!process.env.SHOPIFY_STORE,
  hasShopifyTokenBR: !!process.env.SHOPIFY_ADMIN_TOKEN,
  hasShopifyStoreGlobal: !!process.env.SHOPIFY_STORE_GLOBAL,
  hasShopifyTokenGlobal: !!process.env.SHOPIFY_ADMIN_TOKEN_GLOBAL,
  hasAdminPass: !!process.env.ADMIN_PASS,
});

let redis;
try {
  redis = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  });
  console.log('Redis initialized successfully');
} catch (e) {
  console.error('Redis init error:', e.message);
}

// Configuração das lojas
const STORES = {
  br: {
    name: 'Brasil',
    shopifyStore: process.env.SHOPIFY_STORE,
    shopifyToken: process.env.SHOPIFY_ADMIN_TOKEN,
    redisKey: 'kz:recommendations:br',
    statsPrefix: 'kz:stats:br',
    categories: [
      'Guitarristas', 'Bateristas', 'Tecladistas', 'Cantores', 
      'Baixistas', 'Produtores', 'DJs', 'Gamers',
      'Som: Graves Potentes', 'Som: Equilibrado', 'Som: Energético'
    ]
  },
  global: {
    name: 'Global',
    shopifyStore: process.env.SHOPIFY_STORE_GLOBAL,
    shopifyToken: process.env.SHOPIFY_ADMIN_TOKEN_GLOBAL,
    redisKey: 'kz:recommendations:global',
    statsPrefix: 'kz:stats:global',
    categories: [
      'Guitarists', 'Drummers', 'Keyboardists', 'Singers', 
      'Bassists', 'Producers', 'DJs', 'Gamers',
      'Sound: Deep Bass', 'Sound: Balanced', 'Sound: Energetic'
    ]
  }
};

// Função para obter config da loja
function getStoreConfig(store) {
  return STORES[store] || STORES.br;
}

// Shopify GraphQL
async function shopifyGraphQL(store, query, variables = {}) {
  const config = getStoreConfig(store);
  console.log('Shopify GraphQL call to:', config.shopifyStore);
  const res = await fetch(`https://${config.shopifyStore}/admin/api/2024-10/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': config.shopifyToken,
    },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

// Verifica auth (apenas senha)
function checkAuth(req) {
  const auth = req.headers.get('authorization');
  console.log('Auth header present:', !!auth);
  if (!auth) return false;
  try {
    const decoded = atob(auth.split(' ')[1]);
    // Basic Auth formato: "usuario:senha" - pegamos só a senha (depois do :)
    const pass = decoded.includes(':') ? decoded.split(':')[1] : decoded;
    console.log('Password check:', pass === process.env.ADMIN_PASS);
    return pass === process.env.ADMIN_PASS;
  } catch (e) {
    console.error('Auth decode error:', e.message);
    return false;
  }
}

export default async function handler(req) {
  console.log('Request received:', req.method, req.url);
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  if (!checkAuth(req)) {
    console.log('Auth failed - returning 401');
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Basic' },
    });
  }

  console.log('Auth passed');
  const url = new URL(req.url);
  const action = url.searchParams.get('action');
  const store = url.searchParams.get('store') || 'br'; // Default: Brasil
  const config = getStoreConfig(store);
  
  console.log('Action:', action, 'Store:', store);

  try {
    // GET ?action=stores - Lista lojas disponíveis
    if (action === 'stores') {
      const storeList = Object.entries(STORES).map(([key, val]) => ({
        id: key,
        name: val.name,
        categories: val.categories
      }));
      return new Response(JSON.stringify(storeList), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // GET ?action=categories - Lista categorias da loja
    if (action === 'categories') {
      return new Response(JSON.stringify(config.categories), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // GET ?action=products - Busca produtos da Shopify
    if (action === 'products') {
      const search = url.searchParams.get('search') || '';
      const cursor = url.searchParams.get('cursor') || null;
      
      const query = `
        query ($first: Int!, $query: String, $cursor: String) {
          products(first: $first, query: $query, after: $cursor) {
            pageInfo { hasNextPage, endCursor }
            nodes {
              id
              title
              handle
              featuredImage { url }
              priceRangeV2 { minVariantPrice { amount, currencyCode } }
              variants(first: 1) { nodes { id } }
            }
          }
        }
      `;
      
      const { data, errors } = await shopifyGraphQL(store, query, {
        first: 20,
        query: search || null,
        cursor,
      });

      if (errors) {
        console.error('Shopify errors:', errors);
        return new Response(JSON.stringify({ error: errors[0]?.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify(data.products), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // GET ?action=recommendations - Lista todas as recomendações por categoria
    if (action === 'recommendations') {
      const data = await redis.get(config.redisKey) || {};
      return new Response(JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // POST ?action=save - Salva produto em uma categoria
    if (action === 'save' && req.method === 'POST') {
      const { category, product } = await req.json();
      
      if (!config.categories.includes(category)) {
        return new Response(JSON.stringify({ error: 'Categoria inválida' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const data = await redis.get(config.redisKey) || {};
      if (!data[category]) data[category] = [];
      
      // Evita duplicados
      if (!data[category].find(p => p.handle === product.handle)) {
        data[category].push({
          name: product.title,
          handle: product.handle,
          image: product.image,
          price: product.price,
          currency: product.currency,
          variantId: product.variantId,
        });
        await redis.set(config.redisKey, data);
      }

      return new Response(JSON.stringify({ success: true, data }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // DELETE ?action=remove&category=X&handle=Y - Remove produto de categoria
    if (action === 'remove' && req.method === 'DELETE') {
      const category = url.searchParams.get('category');
      const handle = url.searchParams.get('handle');
      
      const data = await redis.get(config.redisKey) || {};
      if (data[category]) {
        data[category] = data[category].filter(p => p.handle !== handle);
        await redis.set(config.redisKey, data);
      }

      return new Response(JSON.stringify({ success: true, data }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // POST ?action=reorder - Reordena produtos de uma categoria
    if (action === 'reorder' && req.method === 'POST') {
      const { category, order } = await req.json();
      
      const data = await redis.get(config.redisKey) || {};
      if (data[category]) {
        const reordered = order.map(handle => data[category].find(p => p.handle === handle)).filter(Boolean);
        data[category] = reordered;
        await redis.set(config.redisKey, data);
      }

      return new Response(JSON.stringify({ success: true, data }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // GET ?action=stats - Estatísticas
    if (action === 'stats') {
      const prefix = config.statsPrefix;
      const [views, clicks, addToCart, productClicks, productAtc, productTitles] = await Promise.all([
        redis.get(`${prefix}:views`) || 0,
        redis.get(`${prefix}:clicks`) || 0,
        redis.get(`${prefix}:add_to_cart`) || 0,
        redis.hgetall(`${prefix}:product_clicks`) || {},
        redis.hgetall(`${prefix}:product_atc`) || {},
        redis.hgetall(`${prefix}:product_titles`) || {},
      ]);

      const products = Object.entries(productClicks).map(([handle, clickCount]) => ({
        handle,
        title: productTitles[handle] || handle,
        clicks: parseInt(clickCount) || 0,
        addToCart: parseInt(productAtc[handle]) || 0,
      })).sort((a, b) => b.clicks - a.clicks);

      return new Response(JSON.stringify({ views, clicks, addToCart, products }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('HANDLER ERROR:', error.message, error.stack);
    return new Response(JSON.stringify({ error: error.message, stack: error.stack }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export const config = { runtime: 'edge' };
