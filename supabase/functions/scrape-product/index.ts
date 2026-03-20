const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function extractFromPreloadedState(html: string) {
  // ML embeds __PRELOADED_STATE__ in the HTML with product data
  const stateMatch = html.match(/window\.__PRELOADED_STATE__\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
  if (!stateMatch) return null;

  try {
    const state = JSON.parse(stateMatch[1]);
    console.log('Found __PRELOADED_STATE__, keys:', Object.keys(state).join(', '));
    
    // Navigate the state tree to find product info
    const initialState = state?.initialState;
    const components = initialState?.components;
    
    let title = '';
    let price = '';
    let image_url = '';

    // Try to find title
    if (components?.header?.title) title = components.header.title;
    if (!title && initialState?.id) {
      // Search for title in various paths
      const titleComp = components?.short_description?.title || components?.header?.title;
      if (titleComp) title = titleComp;
    }

    // Try to find price
    const priceComp = components?.price;
    if (priceComp?.price?.value) price = priceComp.price.value.toString();
    if (!price && priceComp?.amount) price = priceComp.amount.toString();

    // Try to find image
    const gallery = components?.gallery;
    if (gallery?.pictures?.[0]?.url) image_url = gallery.pictures[0].url;

    if (title || price) {
      return { title, price, image_url };
    }
  } catch (e) {
    console.log('Failed to parse __PRELOADED_STATE__:', e);
  }
  return null;
}

async function fetchHTML(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'identity',
      'Cache-Control': 'no-cache',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
    },
    redirect: 'follow',
  });
  return response.text();
}

function extractFromHTML(html: string) {
  let title = '';
  let price = '';
  let image_url = '';

  // 1. Try JSON-LD structured data
  const jsonLdMatches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of jsonLdMatches) {
    try {
      const jsonData = JSON.parse(match[1].trim());
      const items = Array.isArray(jsonData) ? jsonData : [jsonData];
      for (const item of items) {
        const product = item['@type'] === 'Product' ? item : null;
        if (product) {
          if (!title && product.name) title = product.name;
          if (!image_url && product.image) {
            image_url = Array.isArray(product.image) ? product.image[0] : (typeof product.image === 'string' ? product.image : product.image?.url || '');
          }
          if (!price && product.offers) {
            const p = product.offers.price || product.offers.lowPrice || (Array.isArray(product.offers) ? product.offers[0]?.price : null);
            if (p) price = p.toString();
          }
        }
      }
    } catch { /* ignore */ }
  }

  // 2. Meta tags
  if (!title) {
    const m = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
    if (m) title = m[1].trim();
  }
  if (!title) {
    const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (m) title = m[1].trim();
  }

  // 3. Price from various patterns
  if (!price) {
    const patterns = [
      /"price"\s*:\s*"?([\d]+[.,]?\d*)"?/,
      /"lowPrice"\s*:\s*"?([\d]+[.,]?\d*)"?/,
      /itemprop=["']price["'][^>]*content=["']([\d.,]+)["']/i,
      /R\$\s*([\d]{1,3}(?:\.?\d{3})*(?:,\d{2}))/,
      /data-price=["']([\d.,]+)["']/i,
    ];
    for (const pattern of patterns) {
      const m = html.match(pattern);
      if (m) {
        let p = m[1];
        if (p.includes(',')) p = p.replace(/\./g, '').replace(',', '.');
        const num = parseFloat(p);
        if (!isNaN(num) && num > 0 && num < 100000) {
          price = num.toString();
          break;
        }
      }
    }
  }

  // 4. og:image
  if (!image_url) {
    const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (m) image_url = m[1];
  }

  // Decode entities
  title = title.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'");
  title = title.replace(/\s*[-|–]\s*(Mercado Livre|Amazon|Shopee|Magazine Luiza|Americanas|Casas Bahia|Havan|Submarino).*$/i, '');

  return { title, price, image_url };
}

function extractMLDataFromHTML(html: string) {
  // ML-specific: try to find product data embedded in script tags
  let title = '';
  let price = '';
  let image_url = '';

  // Look for item title in ML-specific patterns
  const titlePatterns = [
    /"item_title"\s*:\s*"([^"]+)"/,
    /"title"\s*:\s*"([^"]{10,200})"/,
    /class="ui-pdp-title"[^>]*>([^<]+)</i,
    /data-testid="pdp-title"[^>]*>([^<]+)</i,
  ];
  for (const p of titlePatterns) {
    const m = html.match(p);
    if (m && m[1].length > 5 && !m[1].includes('Mercado Livre')) {
      title = m[1];
      break;
    }
  }

  // ML price patterns
  const pricePatterns = [
    /"price"\s*:\s*([\d]+(?:\.\d+)?)\s*[,}]/,
    /"amount"\s*:\s*([\d]+(?:\.\d+)?)\s*[,}]/,
    /class="andes-money-amount__fraction"[^>]*>(\d[\d.]*)</i,
  ];
  for (const p of pricePatterns) {
    const m = html.match(p);
    if (m) {
      const num = parseFloat(m[1].replace(/\./g, ''));
      if (!isNaN(num) && num > 0 && num < 100000) {
        price = num.toString();
        break;
      }
    }
  }

  // ML image
  const imgPatterns = [
    /"pictures"\s*:\s*\[\s*\{[^}]*"url"\s*:\s*"([^"]+)"/,
    /data-zoom="([^"]+\.jpe?g[^"]*)"/i,
    /class="ui-pdp-image[^"]*"[^>]*src="([^"]+)"/i,
  ];
  for (const p of imgPatterns) {
    const m = html.match(p);
    if (m) {
      image_url = m[1];
      break;
    }
  }

  if (title || price) {
    return { title, price, image_url };
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url } = await req.json();
    if (!url) {
      return new Response(JSON.stringify({ error: 'URL is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Processing URL:', url);

    const html = await fetchHTML(url);
    console.log('HTML length:', html.length);

    let result = null;
    const isML = url.includes('mercadolivre.com.br') || url.includes('mercadolibre.com');

    if (isML) {
      // Try __PRELOADED_STATE__ first
      result = extractFromPreloadedState(html);
      if (result) console.log('Got data from __PRELOADED_STATE__');

      // Try ML-specific HTML patterns
      if (!result || !result.title) {
        result = extractMLDataFromHTML(html);
        if (result) console.log('Got data from ML HTML patterns');
      }
    }

    // Generic HTML extraction as fallback
    if (!result || !result.title) {
      result = extractFromHTML(html);
      console.log('Got data from generic HTML extraction');
    }

    console.log('Final:', JSON.stringify({ title: result.title?.substring(0, 60), price: result.price, has_image: !!result.image_url }));

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Scrape error:', error);
    return new Response(JSON.stringify({ error: 'Failed to scrape' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
