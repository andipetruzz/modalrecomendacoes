import { Redis } from '@upstash/redis';

let redis;
try {
  redis = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  });
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
    quizKey: 'kz:quiz:br',
    statsPrefix: 'kz:stats:br',
    categories: [
      'Guitarristas', 'Bateristas', 'Tecladistas', 'Cantores', 
      'Baixistas', 'Produtores', 'DJs', 'Gamers',
      'Som: Graves Potentes', 'Som: Equilibrado', 'Som: Energético'
    ],
    quizCategories: [
      'retorno-guitarra-masculino', 'retorno-baixo-masculino', 'retorno-bateria-masculino',
      'retorno-teclado-masculino', 'retorno-vocal-masculino', 'retorno-outros-masculino',
      'retorno-guitarra-feminino', 'retorno-baixo-feminino', 'retorno-bateria-feminino',
      'retorno-teclado-feminino', 'retorno-vocal-feminino', 'retorno-outros-feminino',
      'casual-equilibrado', 'casual-graves', 'casual-energetico',
      'mixagem-eletronica', 'mixagem-rock', 'mixagem-hiphop', 'mixagem-classica',
      'mixagem-pop', 'mixagem-gospel', 'mixagem-diversos',
      'audiovisual-edicao', 'audiovisual-streaming', 'audiovisual-cinema', 'audiovisual-animacao',
      'games-fps', 'games-rpg', 'games-moba', 'games-casual'
    ]
  },
  global: {
    name: 'Global',
    shopifyStore: process.env.SHOPIFY_STORE_GLOBAL,
    shopifyToken: process.env.SHOPIFY_ADMIN_TOKEN_GLOBAL,
    redisKey: 'kz:recommendations:global',
    quizKey: 'kz:quiz:global',
    statsPrefix: 'kz:stats:global',
    categories: [
      'Guitarists', 'Drummers', 'Keyboardists', 'Singers', 
      'Bassists', 'Producers', 'DJs', 'Gamers',
      'Sound: Deep Bass', 'Sound: Balanced', 'Sound: Energetic'
    ],
    quizCategories: []
  }
};

// Labels amigáveis para quiz
const QUIZ_LABELS = {
  'retorno-guitarra-masculino': '🎸 Retorno › Guitarra › Masculino',
  'retorno-baixo-masculino': '🎸 Retorno › Baixo › Masculino',
  'retorno-bateria-masculino': '🥁 Retorno › Bateria › Masculino',
  'retorno-teclado-masculino': '🎹 Retorno › Teclado › Masculino',
  'retorno-vocal-masculino': '🎤 Retorno › Vocal › Masculino',
  'retorno-outros-masculino': '🎶 Retorno › Outros › Masculino',
  'retorno-guitarra-feminino': '🎸 Retorno › Guitarra › Feminino',
  'retorno-baixo-feminino': '🎸 Retorno › Baixo › Feminino',
  'retorno-bateria-feminino': '🥁 Retorno › Bateria › Feminino',
  'retorno-teclado-feminino': '🎹 Retorno › Teclado › Feminino',
  'retorno-vocal-feminino': '🎤 Retorno › Vocal › Feminino',
  'retorno-outros-feminino': '🎶 Retorno › Outros › Feminino',
  'casual-equilibrado': '🎵 Casual › Equilibrado',
  'casual-graves': '🔊 Casual › Graves Potentes',
  'casual-energetico': '⚡ Casual › Energético',
  'mixagem-eletronica': '🎛️ Mixagem › Eletrônica',
  'mixagem-rock': '🤘 Mixagem › Rock/Metal',
  'mixagem-hiphop': '🎤 Mixagem › Hip Hop',
  'mixagem-classica': '🎻 Mixagem › Clássica',
  'mixagem-pop': '🎵 Mixagem › Pop/MPB',
  'mixagem-gospel': '🙏 Mixagem › Gospel',
  'mixagem-diversos': '🎶 Mixagem › Diversos',
  'audiovisual-edicao': '✂️ Audiovisual › Edição',
  'audiovisual-streaming': '📡 Audiovisual › Streaming',
  'audiovisual-cinema': '🎥 Audiovisual › Cinema',
  'audiovisual-animacao': '🎨 Audiovisual › Animação',
  'games-fps': '🎯 Games › FPS/Competitivo',
  'games-rpg': '⚔️ Games › RPG/Aventura',
  'games-moba': '🏰 Games › MOBA/Estratégia',
  'games-casual': '🎮 Games › Casual'
};

// Função para obter config da loja
function getStoreConfig(store) {
  return STORES[store] || STORES.br;
}

// Shopify GraphQL
async function shopifyGraphQL(store, query, variables = {}) {
  const config = getStoreConfig(store);
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
  if (!auth) return false;
  try {
    const decoded = atob(auth.split(' ')[1]);
    const pass = decoded.includes(':') ? decoded.split(':')[1] : decoded;
    return pass === process.env.ADMIN_PASS;
  } catch {
    return false;
  }
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
  const store = url.searchParams.get('store') || 'br';
  const config = getStoreConfig(store);

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
        redis.get(`${prefix}:views`),
        redis.get(`${prefix}:clicks`),
        redis.get(`${prefix}:add_to_cart`),
        redis.hgetall(`${prefix}:product_clicks`),
        redis.hgetall(`${prefix}:product_atc`),
        redis.hgetall(`${prefix}:product_titles`),
      ]);

      const clicksObj = productClicks || {};
      const atcObj = productAtc || {};
      const titlesObj = productTitles || {};

      const products = Object.entries(clicksObj).map(([handle, clickCount]) => ({
        handle,
        title: titlesObj[handle] || handle,
        clicks: parseInt(clickCount) || 0,
        addToCart: parseInt(atcObj[handle]) || 0,
      })).sort((a, b) => b.clicks - a.clicks);

      return new Response(JSON.stringify({ 
        views: views || 0, 
        clicks: clicks || 0, 
        addToCart: addToCart || 0, 
        products 
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ==================== QUIZ ENDPOINTS ====================

    // GET ?action=quiz-categories - Lista categorias do quiz com labels
    if (action === 'quiz-categories') {
      const categories = config.quizCategories.map(cat => ({
        id: cat,
        label: QUIZ_LABELS[cat] || cat
      }));
      return new Response(JSON.stringify(categories), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // GET ?action=quiz-data - Retorna dados do quiz
    if (action === 'quiz-data') {
      const data = await redis.get(config.quizKey) || {};
      return new Response(JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // POST ?action=quiz-save - Salva produto em uma categoria do quiz
    if (action === 'quiz-save' && req.method === 'POST') {
      const { category, product } = await req.json();
      
      if (!config.quizCategories.includes(category)) {
        return new Response(JSON.stringify({ error: 'Categoria inválida: ' + category }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const data = await redis.get(config.quizKey) || {};
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
        await redis.set(config.quizKey, data);
      }

      return new Response(JSON.stringify({ success: true, data }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // DELETE ?action=quiz-remove&category=X&handle=Y - Remove produto do quiz
    if (action === 'quiz-remove' && req.method === 'DELETE') {
      const category = url.searchParams.get('category');
      const handle = url.searchParams.get('handle');
      
      const data = await redis.get(config.quizKey) || {};
      if (data[category]) {
        data[category] = data[category].filter(p => p.handle !== handle);
        await redis.set(config.quizKey, data);
      }

      return new Response(JSON.stringify({ success: true, data }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // POST ?action=quiz-reorder - Reordena produtos do quiz
    if (action === 'quiz-reorder' && req.method === 'POST') {
      const { category, order } = await req.json();
      
      const data = await redis.get(config.quizKey) || {};
      if (data[category]) {
        const reordered = order.map(handle => data[category].find(p => p.handle === handle)).filter(Boolean);
        data[category] = reordered;
        await redis.set(config.quizKey, data);
      }

      return new Response(JSON.stringify({ success: true, data }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // GET ?action=quiz-stats - Estatísticas do quiz
    if (action === 'quiz-stats') {
      const prefix = config.statsPrefix;
      const [starts, completions, productClicks, productAtc, productTitles] = await Promise.all([
        redis.get(`${prefix}:quiz:starts`),
        redis.get(`${prefix}:quiz:completions`),
        redis.hgetall(`${prefix}:quiz:product_clicks`),
        redis.hgetall(`${prefix}:quiz:product_atc`),
        redis.hgetall(`${prefix}:quiz:product_titles`),
      ]);

      const clicksObj = productClicks || {};
      const atcObj = productAtc || {};
      const titlesObj = productTitles || {};

      const products = Object.entries(clicksObj).map(([handle, clickCount]) => ({
        handle,
        title: titlesObj[handle] || handle,
        clicks: parseInt(clickCount) || 0,
        addToCart: parseInt(atcObj[handle]) || 0,
      })).sort((a, b) => b.clicks - a.clicks);

      const startsNum = parseInt(starts) || 0;
      const completionsNum = parseInt(completions) || 0;
      const completionRate = startsNum > 0 ? ((completionsNum / startsNum) * 100).toFixed(1) : '0';

      return new Response(JSON.stringify({ 
        starts: startsNum, 
        completions: completionsNum, 
        completionRate, 
        products 
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // POST ?action=quiz-seed - Pré-popula quiz com dados iniciais
    if (action === 'quiz-seed' && req.method === 'POST') {
      const initialData = {
        // Retorno - Masculino
        'retorno-guitarra-masculino': ['kz-as16-pro', 'kz-castor-pro'],
        'retorno-baixo-masculino': ['kz-zar', 'kz-castor-pro'],
        'retorno-bateria-masculino': ['kz-zsx-pro-12-drivers-lancamento-exclusivo', 'kz-castor-pro'],
        'retorno-teclado-masculino': ['kz-as16-pro', 'kz-d-fi'],
        'retorno-vocal-masculino': ['kz-za12-novo-fone-in-ear-hibrido-profissional', 'kz-zsn-pro-2-lancamento-2024'],
        'retorno-outros-masculino': ['kz-as16-pro', 'kz-castor-pro'],
        // Retorno - Feminino
        'retorno-guitarra-feminino': ['kz-zs10-pro-2', 'kz-castor-pro'],
        'retorno-baixo-feminino': ['kz-zs10-pro-2', 'kz-castor'],
        'retorno-bateria-feminino': ['kz-zs10-pro-2', 'kz-castor'],
        'retorno-teclado-feminino': ['kz-zs10-pro-2', 'fone-de-ouvido-in-ear-kz-zna-12mm'],
        'retorno-vocal-feminino': ['kz-zs10-pro-2', 'kz-zsn-pro-2-lancamento-2024'],
        'retorno-outros-feminino': ['kz-zs10-pro-2', 'kz-castor-pro'],
        // Casual
        'casual-equilibrado': ['kz-zsn-pro-2-lancamento-2024', 'kz-castor-pro', 'kz-carol-fone-de-ouvido-bluetooth-5-3-com-reducao-de-ruido-ativa-anc'],
        'casual-graves': ['kz-castor', 'kz-zsx', 'fone-de-ouvido-bluetooth-kz-sa08-pro'],
        'casual-energetico': ['kz-zs10-pro-x', 'kz-zsn-pro-x', 'fone-bluetooth-kz-sks-tws'],
        // Mixagem
        'mixagem-eletronica': ['kz-sonata-28-drivers-fone-de-ouvido-in-ear-profissional', 'kz-as16-pro'],
        'mixagem-rock': ['kz-sonata-28-drivers-fone-de-ouvido-in-ear-profissional', 'kz-as16-pro'],
        'mixagem-hiphop': ['novo-kz-as24-pro-24-drivers-hifi-profissionais', 'kz-as16-pro'],
        'mixagem-classica': ['kz-sonata-28-drivers-fone-de-ouvido-in-ear-profissional', 'kz-as16-pro'],
        'mixagem-pop': ['kz-sonata-28-drivers-fone-de-ouvido-in-ear-profissional', 'kz-as16-pro'],
        'mixagem-gospel': ['novo-kz-as24-pro-24-drivers-hifi-profissionais', 'kz-as16-pro'],
        'mixagem-diversos': ['novo-kz-as24-pro-24-drivers-hifi-profissionais', 'kz-as16-pro'],
        // Audiovisual
        'audiovisual-edicao': ['kz-as16-pro', 'kz-zsn-pro-2-lancamento-2024'],
        'audiovisual-streaming': ['kz-zsn-pro-2-lancamento-2024', 'fone-de-ouvido-in-ear-kz-zna-12mm'],
        'audiovisual-cinema': ['kz-as16-pro', 'fone-de-ouvido-in-ear-kz-zna-12mm'],
        'audiovisual-animacao': ['fone-de-ouvido-in-ear-kz-zna-12mm', 'kz-as16-pro'],
        // Games
        'games-fps': ['kz-edx-pro-gamer', 'kz-zs10-pro-2-gamer-lancamento-2024', 'kz-sora-5-4-fone-bluetooth-com-cancelamento-de-ruido'],
        'games-rpg': ['kz-edx-pro-gamer', 'kz-zsn-pro-2-fone-de-ouvido-in-ear-gamer-lancamento', 'kz-sora-5-4-fone-bluetooth-com-cancelamento-de-ruido'],
        'games-moba': ['kz-edx-pro-gamer', 'kz-zs10-pro-2-gamer-lancamento-2024', 'kz-sora-5-4-fone-bluetooth-com-cancelamento-de-ruido'],
        'games-casual': ['kz-edx-pro-gamer', 'kz-zs10-pro-2-gamer-lancamento-2024', 'kz-sora-5-4-fone-bluetooth-com-cancelamento-de-ruido']
      };

      // Coleta todos os handles únicos
      const allHandles = [...new Set(Object.values(initialData).flat())];
      
      // Busca produtos em lotes (Shopify limita a query)
      const productsMap = {};
      
      // Busca cada produto individualmente pelo handle
      for (const handle of allHandles) {
        const query = `
          query ($handle: String!) {
            productByHandle(handle: $handle) {
              id
              title
              handle
              featuredImage { url }
              priceRangeV2 { minVariantPrice { amount, currencyCode } }
              variants(first: 1) { nodes { id } }
            }
          }
        `;
        
        try {
          const { data } = await shopifyGraphQL(store, query, { handle });
          if (data?.productByHandle) {
            const p = data.productByHandle;
            productsMap[p.handle] = {
              name: p.title,
              handle: p.handle,
              image: p.featuredImage?.url,
              price: p.priceRangeV2?.minVariantPrice?.amount,
              currency: p.priceRangeV2?.minVariantPrice?.currencyCode,
              variantId: p.variants?.nodes?.[0]?.id,
            };
          }
        } catch (e) {
          console.error(`Failed to fetch product ${handle}:`, e.message);
        }
      }

      // Monta dados finais do quiz
      const quizData = {};
      for (const [category, handles] of Object.entries(initialData)) {
        quizData[category] = handles
          .map(handle => productsMap[handle])
          .filter(Boolean);
      }

      await redis.set(config.quizKey, quizData);

      return new Response(JSON.stringify({ 
        success: true, 
        data: quizData, 
        productsFound: Object.keys(productsMap).length,
        totalHandles: allHandles.length
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Handler error:', error.message);
    return new Response(JSON.stringify({ error: 'Internal error: ' + error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export const config = { runtime: 'edge' };
