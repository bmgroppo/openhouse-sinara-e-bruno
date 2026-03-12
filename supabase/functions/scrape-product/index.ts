const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

async function scrapeFromMercadoLivreAPI(url: string) {
  // Extract MLB ID from URL
  // Try multiple patterns for MLB ID
  const mlbMatch = url.match(/MLB[-_]?(\d+)/i) || url.match(/MLB(\d+)/i);
  if (!mlbMatch) {
    console.log('No MLB ID found in URL:', url);
    return null;
  }

  const itemId = `MLB${mlbMatch[1]}`;
  console.log('Using MercadoLivre API for item:', itemId);

  try {
    const response = await fetch(`https://api.mercadolibre.com/items/${itemId}`);
  if (!response.ok) {
    console.log('ML API failed:', response.status);
    return null;
  }

  const data = await response.json();
  return {
    title: data.title || '',
    price: data.price?.toString() || '',
    image_url: data.pictures?.[0]?.secure_url || data.thumbnail?.replace('http:', 'https:') || '',
  };
}

async function scrapeFromAmazonAPI(url: string) {
  // Amazon doesn't have a simple public API, rely on HTML scraping
  return null;
}

async function scrapeFromHTML(url: string) {
  console.log('Scraping HTML from:', url);

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'identity',
      'Cache-Control': 'no-cache',
    },
    redirect: 'follow',
  });

  const html = await response.text();
  console.log('HTML length:', html.length);

  // Try JSON-LD first (most reliable)
  let title = '';
  let price = '';
  let image_url = '';

  const jsonLdMatches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of jsonLdMatches) {
    try {
      const jsonData = JSON.parse(match[1].trim());
      const items = Array.isArray(jsonData) ? jsonData : [jsonData];
      for (const item of items) {
        const product = item['@type'] === 'Product' ? item : item.mainEntity?.['@type'] === 'Product' ? item.mainEntity : null;
        if (product) {
          if (!title && product.name) title = product.name;
          if (!image_url && product.image) {
            image_url = Array.isArray(product.image) ? product.image[0] : (typeof product.image === 'string' ? product.image : product.image?.url || '');
          }
          const offers = product.offers;
          if (!price && offers) {
            const offerPrice = offers.price || offers.lowPrice || (Array.isArray(offers) ? offers[0]?.price : null);
            if (offerPrice) price = offerPrice.toString();
          }
        }
      }
    } catch {
      // ignore invalid JSON-LD
    }
  }

  // og:title
  if (!title) {
    const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
    if (ogTitle) title = ogTitle[1].trim();
  }

  // twitter:title
  if (!title) {
    const twTitle = html.match(/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:title["']/i);
    if (twTitle) title = twTitle[1].trim();
  }

  // <title> tag
  if (!title) {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) title = titleMatch[1].trim();
  }

  // Price patterns
  if (!price) {
    const pricePatterns = [
      /"price"\s*:\s*"?([\d]+[.,]?\d*)"?/,
      /"lowPrice"\s*:\s*"?([\d]+[.,]?\d*)"?/,
      /R\$\s*([\d]{1,3}(?:\.?\d{3})*(?:,\d{2}))/,
      /class="[^"]*price[^"]*"[^>]*>(?:[^<]*?)R?\$?\s*([\d]{1,3}(?:\.?\d{3})*(?:,\d{2}))/i,
      /data-price=["']([\d.,]+)["']/i,
      /itemprop=["']price["'][^>]*content=["']([\d.,]+)["']/i,
      /\"priceAmount\"\s*:\s*\"?([\d]+\.?\d*)\"?/i,
    ];
    for (const pattern of pricePatterns) {
      const match = html.match(pattern);
      if (match) {
        let p = match[1];
        if (p.includes(',')) {
          p = p.replace(/\./g, '').replace(',', '.');
        }
        const num = parseFloat(p);
        if (!isNaN(num) && num > 0 && num < 100000) {
          price = num.toString();
          break;
        }
      }
    }
  }

  // og:image
  if (!image_url) {
    const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (ogImage) image_url = ogImage[1];
  }

  // Decode HTML entities
  title = title.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'");

  // Clean up title - remove site name suffixes
  title = title.replace(/\s*[-|–]\s*(Mercado Livre|Amazon|Shopee|Magazine Luiza|Americanas|Casas Bahia|Havan|Submarino|Ponto|Extra).*$/i, '');

  return { title, price, image_url };
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

    let result = null;

    // Try MercadoLivre API first for ML URLs
    if (url.includes('mercadolivre.com.br') || url.includes('mercadolibre.com') || url.match(/MLB[- ]?\d+/i)) {
      result = await scrapeFromMercadoLivreAPI(url);
    }

    // Fallback to HTML scraping
    if (!result || (!result.title && !result.price)) {
      result = await scrapeFromHTML(url);
    }

    console.log('Result:', { title: result.title?.substring(0, 60), price: result.price, image_url: result.image_url?.substring(0, 60) });

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
