import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Categorias disponíveis
const CATEGORIES = [
  'Guitarristas', 'Bateristas', 'Tecladistas', 'Cantores', 
  'Baixistas', 'Produtores', 'DJs', 'Gamers'
];

// Shopify GraphQL
async function shopifyGraphQL(query, variables = {}) {
  const res = await fetch(`https://${process.env.SHOPIFY_STORE}/admin/api/2024-01/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

// Verifica auth (apenas senha)
function checkAuth(req) {
  const auth = req.headers.get('authorization');
  if (!auth) return false;
  const pass = Buffer.from(auth.split(' ')[1], 'base64').toString();
  return pass === process.env.ADMIN_PASS;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  if (!checkAuth(req)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Basic' },
    });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  try {
    // GET ?action=categories - Lista categorias disponíveis
    if (action === 'categories') {
      return new Response(JSON.stringify(CATEGORIES), {
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
      
      const { data } = await shopifyGraphQL(query, {
        first: 20,
        query: search ? `title:*${search}*` : null,
        cursor,
      });

      return new Response(JSON.stringify(data.products), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // GET ?action=recommendations - Lista todas as recomendações por categoria
    if (action === 'recommendations') {
      const data = await redis.get('kz:recommendations') || {};
      return new Response(JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // POST ?action=save - Salva produto em uma categoria
    if (action === 'save' && req.method === 'POST') {
      const { category, product } = await req.json();
      
      if (!CATEGORIES.includes(category)) {
        return new Response(JSON.stringify({ error: 'Categoria inválida' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const data = await redis.get('kz:recommendations') || {};
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
        await redis.set('kz:recommendations', data);
      }

      return new Response(JSON.stringify({ success: true, data }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // DELETE ?action=remove&category=X&handle=Y - Remove produto de categoria
    if (action === 'remove' && req.method === 'DELETE') {
      const category = url.searchParams.get('category');
      const handle = url.searchParams.get('handle');
      
      const data = await redis.get('kz:recommendations') || {};
      if (data[category]) {
        data[category] = data[category].filter(p => p.handle !== handle);
        await redis.set('kz:recommendations', data);
      }

      return new Response(JSON.stringify({ success: true, data }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // POST ?action=reorder - Reordena produtos de uma categoria
    if (action === 'reorder' && req.method === 'POST') {
      const { category, order } = await req.json();
      
      const data = await redis.get('kz:recommendations') || {};
      if (data[category]) {
        const reordered = order.map(handle => data[category].find(p => p.handle === handle)).filter(Boolean);
        data[category] = reordered;
        await redis.set('kz:recommendations', data);
      }

      return new Response(JSON.stringify({ success: true, data }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // GET ?action=stats - Estatísticas
    if (action === 'stats') {
      const [views, clicks, addToCart, productClicks, productAtc, productTitles] = await Promise.all([
        redis.get('kz:stats:views') || 0,
        redis.get('kz:stats:clicks') || 0,
        redis.get('kz:stats:add_to_cart') || 0,
        redis.hgetall('kz:stats:product_clicks') || {},
        redis.hgetall('kz:stats:product_atc') || {},
        redis.hgetall('kz:stats:product_titles') || {},
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
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export const config = { runtime: 'edge' };
