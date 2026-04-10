const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function extractPriceFromText(text: string): string {
  // BRL patterns: R$ 1.234,56 or R$ 234,56 or R$234.56
  const patterns = [
    /R\$\s*([\d]{1,3}(?:\.?\d{3})*(?:,\d{2}))/,
    /R\$\s*([\d]+[.,]?\d*)/,
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

function cleanTitle(title: string): string {
  return title
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/\s*[-|–]\s*(Mercado Livre|Amazon|Shopee|Magazine Luiza|Americanas|Casas Bahia|Havan|Submarino).*$/i, '')
    .trim();
}

async function scrapeWithFirecrawl(url: string): Promise<{ title: string; price: string; image_url: string } | null> {
  const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
  if (!apiKey) {
    console.log('No FIRECRAWL_API_KEY, skipping Firecrawl');
    return null;
  }

  console.log('Trying Firecrawl for:', url);
  const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url,
      formats: ['markdown', 'html'],
      onlyMainContent: false,
      waitFor: 5000,
      location: { country: 'BR', languages: ['pt-BR'] },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error('Firecrawl error:', response.status, err);
    return null;
  }

  const data = await response.json();
  const metadata = data?.data?.metadata || data?.metadata || {};
  const markdown = data?.data?.markdown || data?.markdown || '';

  console.log('Firecrawl metadata keys:', Object.keys(metadata).join(', '));

  const title = cleanTitle(metadata.ogTitle || metadata.title || '');
  const image_url = metadata.ogImage || '';
  let price = '';

  // Try price from metadata (some sites include it)
  if (metadata.price) {
    price = metadata.price.toString();
  }

  // Extract price from markdown content
  if (!price && markdown) {
    price = extractPriceFromText(markdown);
  }

  if (title || price || image_url) {
    console.log('Firecrawl success:', { title: title.substring(0, 60), price, hasImage: !!image_url });
    return { title, price, image_url };
  }

  console.log('Firecrawl returned no useful data');
  return null;
}

async function scrapeWithFetch(url: string): Promise<{ title: string; price: string; image_url: string }> {
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
  console.log('Fallback fetch HTML length:', html.length);

  let title = '';
  let price = '';
  let image_url = '';

  // JSON-LD
  const jsonLdMatches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of jsonLdMatches) {
    try {
      const jsonData = JSON.parse(match[1].trim());
      const items = Array.isArray(jsonData) ? jsonData : [jsonData];
      for (const item of items) {
        if (item['@type'] === 'Product') {
          if (!title && item.name) title = item.name;
          if (!image_url && item.image) {
            image_url = Array.isArray(item.image) ? item.image[0] : (typeof item.image === 'string' ? item.image : item.image?.url || '');
          }
          if (!price && item.offers) {
            const p = item.offers.price || item.offers.lowPrice || (Array.isArray(item.offers) ? item.offers[0]?.price : null);
            if (p) price = p.toString();
          }
        }
      }
    } catch { /* ignore */ }
  }

  // Meta tags
  if (!title) {
    const m = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)
      || html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (m) title = m[1].trim();
  }

  if (!price) price = extractPriceFromText(html);

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

    console.log('Processing URL:', url);

    // 1. Try Firecrawl first
    let result = await scrapeWithFirecrawl(url);

    // 2. Fallback to direct fetch
    if (!result || !result.title) {
      console.log('Falling back to direct fetch');
      const fallback = await scrapeWithFetch(url);
      result = {
        title: result?.title || fallback.title,
        price: result?.price || fallback.price,
        image_url: result?.image_url || fallback.image_url,
      };
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
