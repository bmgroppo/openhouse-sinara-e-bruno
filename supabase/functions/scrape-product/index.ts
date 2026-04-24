const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function cleanTitle(title: string): string {
  return title
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/\s*[-|–]\s*(Mercado Livre|Mercado Libre|Amazon\.com\.br|Amazon|Shopee|Magazine Luiza|Americanas|Casas Bahia|Havan|Submarino).*$/i, '')
    .trim();
}

function extractPriceFromText(text: string): string {
  const patterns = [
    /R\$\s*([\d]{1,3}(?:\.\d{3})*,\d{2})/,
    /R\$\s*([\d]+,\d{2})/,
    /"price"\s*:\s*"?([\d]+(?:[.,]\d+)?)"?/,
    /"lowPrice"\s*:\s*"?([\d]+(?:[.,]\d+)?)"?/,
  ];
  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m) {
      let p = m[1];
      if (p.includes(',')) p = p.replace(/\./g, '').replace(',', '.');
      const num = parseFloat(p);
      if (!isNaN(num) && num > 0 && num < 100000) return num.toString();
    }
  }
  return '';
}

function extractFromHTML(html: string): { title: string; price: string; image_url: string } {
  let title = '';
  let price = '';
  let image_url = '';

  // JSON-LD (most reliable)
  const jsonLdMatches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of jsonLdMatches) {
    try {
      const jsonData = JSON.parse(match[1].trim());
      const items = Array.isArray(jsonData) ? jsonData : [jsonData];
      for (const item of items) {
        if (item['@type'] === 'Product') {
          if (!title && item.name) title = item.name;
          if (!image_url && item.image) {
            image_url = Array.isArray(item.image)
              ? item.image[0]
              : (typeof item.image === 'string' ? item.image : item.image?.url || '');
          }
          if (!price && item.offers) {
            const p = item.offers.price || item.offers.lowPrice || (Array.isArray(item.offers) ? item.offers[0]?.price : null);
            if (p) price = p.toString();
          }
        }
      }
    } catch { /* ignore */ }
  }

  // og:title fallback
  if (!title) {
    const m = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)
      || html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (m) title = m[1].trim();
  }

  if (!price) price = extractPriceFromText(html);

  // og:image fallback
  if (!image_url) {
    const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (m) image_url = m[1];
  }

  title = cleanTitle(title);
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

    console.log('Scraping:', url);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'identity',
      },
      redirect: 'follow',
    });

    const html = await response.text();
    console.log('HTML length:', html.length);

    const result = extractFromHTML(html);
    console.log('Result:', JSON.stringify({ title: result.title?.substring(0, 60), price: result.price, has_image: !!result.image_url }));

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
