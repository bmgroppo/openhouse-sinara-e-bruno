const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const GARBAGE_TITLES = [
  'mercado libre', 'mercado livre', 'amazon', 'shopee', 'page not found',
  'não foi possível', 'error', 'access denied', 'robot', 'captcha',
  'just a moment', 'verificação', 'login',
];

function isGarbageTitle(title: string): boolean {
  const lower = title.toLowerCase().trim();
  if (lower.length < 5) return true;
  return GARBAGE_TITLES.some(g => lower === g || lower.startsWith(g + ' -') || lower.startsWith(g + ' |'));
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

function cleanTitle(title: string): string {
  return title
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/\s*[-|–]\s*(Mercado Livre|Mercado Libre|Amazon\.com\.br|Amazon|Shopee|Magazine Luiza|Americanas|Casas Bahia|Havan|Submarino).*$/i, '')
    .trim();
}

function extractFromHTML(html: string): { title: string; price: string; image_url: string } {
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

  // og:title
  if (!title) {
    const m = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)
      || html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (m) title = m[1].trim();
  }

  if (!price) price = extractPriceFromText(html);

  // og:image
  if (!image_url) {
    const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (m) image_url = m[1];
  }

  title = cleanTitle(title);
  return { title, price, image_url };
}

async function scrapeWithFirecrawl(url: string): Promise<{ title: string; price: string; image_url: string } | null> {
  const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
  if (!apiKey) {
    console.log('No FIRECRAWL_API_KEY, skipping');
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
  const html = data?.data?.html || data?.html || '';

  console.log('Firecrawl metadata:', JSON.stringify({ title: metadata.title, ogTitle: metadata.ogTitle, ogImage: metadata.ogImage?.substring(0, 80), statusCode: metadata.statusCode }));
  console.log('Firecrawl markdown length:', markdown.length, 'html length:', html.length);

  // Try metadata first
  let title = cleanTitle(metadata.ogTitle || metadata.title || '');
  let image_url = metadata.ogImage || '';
  let price = '';

  // If we got HTML from Firecrawl, parse it for structured data
  if (html) {
    const htmlResult = extractFromHTML(html);
    if (!title || isGarbageTitle(title)) title = htmlResult.title;
    if (!price) price = htmlResult.price;
    if (!image_url) image_url = htmlResult.image_url;
  }

  // Extract price from markdown
  if (!price && markdown) {
    price = extractPriceFromText(markdown);
  }

  // Validate result
  if (isGarbageTitle(title)) title = '';

  if (title || price || image_url) {
    console.log('Firecrawl result:', { title: title.substring(0, 60), price, hasImage: !!image_url });
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
  console.log('Fallback HTML length:', html.length);
  return extractFromHTML(html);
}

// Extract product info from URL slug as last resort
function extractFromSlug(url: string): { title: string } {
  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split('/').filter(s => s.length > 5 && !s.match(/^[A-Z0-9]{10,}$/));
    const slug = segments.pop() || '';
    const title = slug
      .replace(/[-_]/g, ' ')
      .replace(/\b(p|dp|ref|MLB|MLA|gp)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (title.length > 10) {
      return { title: title.charAt(0).toUpperCase() + title.slice(1) };
    }
  } catch { /* ignore */ }
  return { title: '' };
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

    let title = '';
    let price = '';
    let image_url = '';

    // 1. Firecrawl
    const fc = await scrapeWithFirecrawl(url);
    if (fc) {
      title = fc.title;
      price = fc.price;
      image_url = fc.image_url;
    }

    // 2. Direct fetch fallback
    if (!title || !price) {
      console.log('Trying direct fetch fallback');
      const fb = await scrapeWithFetch(url);
      if (!title || isGarbageTitle(title)) title = fb.title;
      if (!price) price = fb.price;
      if (!image_url) image_url = fb.image_url;
    }

    // 3. URL slug as last resort for title
    if (!title || isGarbageTitle(title)) {
      const slug = extractFromSlug(url);
      if (slug.title) title = slug.title;
    }

    const result = { title, price, image_url };
    console.log('Final:', JSON.stringify({ title: title?.substring(0, 60), price, has_image: !!image_url }));

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
