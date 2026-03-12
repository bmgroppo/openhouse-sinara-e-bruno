const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

async function scrapeFromMercadoLivreAPI(url: string) {
  const mlbMatch = url.match(/MLB[-_]?(\d+)/i);
  if (!mlbMatch) {
    console.log('No MLB ID found in URL');
    return null;
  }

  const itemId = `MLB${mlbMatch[1]}`;
  console.log('Using MercadoLivre API for item:', itemId);

  try {
    const response = await fetch(`https://api.mercadolibre.com/items/${itemId}`);
    if (!response.ok) {
      const body = await response.text();
      console.log('ML API failed:', response.status, body.substring(0, 200));
      return null;
    }

    const data = await response.json();
    console.log('ML API success:', data.title?.substring(0, 50), data.price);
    return {
      title: data.title || '',
      price: data.price?.toString() || '',
      image_url: data.pictures?.[0]?.secure_url || data.thumbnail?.replace('http:', 'https:') || '',
    };
  } catch (e) {
    console.error('ML API error:', e);
    return null;
  }
}

async function scrapeFromHTML(url: string) {
  console.log('Scraping HTML from:', url);

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'identity',
      'Cache-Control': 'no-cache',
    },
    redirect: 'follow',
  });

  const html = await response.text();
  console.log('HTML length:', html.length);

  let title = '';
  let price = '';
  let image_url = '';

  // Try JSON-LD structured data first
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
          const offers = product.offers;
          if (!price && offers) {
            const offerPrice = offers.price || offers.lowPrice || (Array.isArray(offers) ? offers[0]?.price : null);
            if (offerPrice) price = offerPrice.toString();
          }
        }
      }
    } catch { /* ignore */ }
  }

  // og:title
  if (!title) {
    const m = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
    if (m) title = m[1].trim();
  }

  // <title> tag
  if (!title) {
    const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (m) title = m[1].trim();
  }

  // Price
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

  // og:image
  if (!image_url) {
    const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (m) image_url = m[1];
  }

  // Decode entities & clean title
  title = title.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'");
  title = title.replace(/\s*[-|–]\s*(Mercado Livre|Amazon|Shopee|Magazine Luiza|Americanas|Casas Bahia|Havan|Submarino).*$/i, '');

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

    // Try MercadoLivre API for ML URLs
    if (url.includes('mercadolivre.com.br') || url.includes('mercadolibre.com')) {
      result = await scrapeFromMercadoLivreAPI(url);
    }

    // Fallback to HTML scraping
    if (!result || !result.title) {
      result = await scrapeFromHTML(url);
    }

    console.log('Final result:', JSON.stringify({ title: result.title?.substring(0, 60), price: result.price, has_image: !!result.image_url }));

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
