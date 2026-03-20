const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface ProductData {
  title: string;
  price: string;
  image_url: string;
}

async function fetchHTML(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
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

function extractFromHTML(html: string): ProductData {
  let title = '';
  let price = '';
  let image_url = '';

  // 1. JSON-LD structured data
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
            const offers = Array.isArray(item.offers) ? item.offers[0] : item.offers;
            const p = offers?.price || offers?.lowPrice;
            if (p) price = p.toString();
          }
        }
      }
    } catch { /* ignore */ }
  }

  // 2. Meta tags - og:image first (most reliable for ML)
  if (!image_url) {
    const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (m) image_url = m[1];
  }

  // 3. ML-specific image patterns from __PRELOADED_STATE__ or inline data
  if (!image_url) {
    const m = html.match(/"(https:\/\/http2\.mlstatic\.com\/D_NQ_NP_[^"]+)"/);
    if (m) image_url = m[1];
  }

  // 4. Meta tags for title
  if (!title) {
    const m = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
    if (m) title = m[1].trim();
  }
  if (!title) {
    const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (m) title = m[1].trim();
  }

  // 5. Amazon-specific title
  if (!title || title.includes('Amazon')) {
    const m = html.match(/id=["']productTitle["'][^>]*>\s*([^<]+)/i);
    if (m && m[1].trim().length > 5) title = m[1].trim();
  }

  // 6. Price
  if (!price) {
    const patterns = [
      /"price"\s*:\s*"?([\d]+[.,]?\d*)"?/,
      /"lowPrice"\s*:\s*"?([\d]+[.,]?\d*)"?/,
      /itemprop=["']price["'][^>]*content=["']([\d.,]+)["']/i,
      /R\$\s*(?:<[^>]*>)*\s*([\d]{1,3}(?:\.?\d{3})*(?:,\d{2}))/,
      /data-price=["']([\d.,]+)["']/i,
    ];
    for (const pattern of patterns) {
      const m = html.match(pattern);
      if (m) {
        let p = m[1];
        if (p.includes(',')) p = p.replace(/\./g, '').replace(',', '.');
        const num = parseFloat(p);
        if (!isNaN(num) && num > 0 && num < 1000000) {
          price = num.toString();
          break;
        }
      }
    }
  }

  // 7. Amazon images
  if (!image_url) {
    const m = html.match(/id=["']landingImage["'][^>]*src=["']([^"']+)["']/i)
      || html.match(/"hiRes"\s*:\s*"([^"]+)"/);
    if (m) image_url = m[1];
  }
  if (!image_url) {
    const m = html.match(/data-a-dynamic-image=["']\{([^}]+)\}/i);
    if (m) {
      const imgMatch = m[1].match(/"(https:\/\/[^"]+)"/);
      if (imgMatch) image_url = imgMatch[1];
    }
  }

  // Clean title
  title = title.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'");
  title = title.replace(/\s*[-|–]\s*(Mercado Livre|Amazon\.com\.br|Amazon|Shopee|Magazine Luiza|Americanas|Casas Bahia|Havan|Submarino).*$/i, '');
  title = title.trim();

  return { title, price, image_url };
}

// Extract product info from ML URL patterns
function extractFromMLUrl(url: string): ProductData {
  let title = '';

  // Extract title from URL slug
  const slugMatch = url.match(/\.com\.br\/(?:MLB-?\d+-)?([a-z0-9-]+?)(?:-_JM|\?|#|$)/i);
  if (slugMatch && slugMatch[1]) {
    title = slugMatch[1]
      .replace(/-/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
      .trim();
  }

  if (!title) {
    const pMatch = url.match(/\.com\.br\/([^/?#]+?)\/p\//i);
    if (pMatch) {
      title = decodeURIComponent(pMatch[1])
        .replace(/-/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase())
        .trim();
    }
  }

  return { title, price: '', image_url: '' };
}

// Try ML public API for image
async function fetchMLImage(url: string): Promise<string> {
  // Extract item ID from various ML URL formats
  const idMatch = url.match(/MLB-?(\d+)/i) || url.match(/\/p\/(MLB\d+)/i);
  if (!idMatch) return '';

  const itemId = `MLB${idMatch[1].replace(/^MLB/i, '')}`;
  try {
    const resp = await fetch(`https://api.mercadolibre.com/items/${itemId}?attributes=pictures,thumbnail`, {
      headers: { 'Accept': 'application/json' },
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data.pictures && data.pictures.length > 0) {
        return data.pictures[0].secure_url || data.pictures[0].url || '';
      }
      if (data.thumbnail) {
        return data.thumbnail.replace('http://', 'https://').replace('-I.jpg', '-O.jpg');
      }
    } else {
      await resp.text(); // consume body
    }
  } catch { /* ignore */ }
  return '';
}

// Extract from Amazon URL
function extractFromAmazonUrl(url: string): ProductData {
  let title = '';
  const slugMatch = url.match(/amazon\.com\.br\/([^/]+)\/dp\//);
  if (slugMatch) {
    title = decodeURIComponent(slugMatch[1]).replace(/-/g, ' ').trim();
  }
  return { title, price: '', image_url: '' };
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

    const isML = url.includes('mercadolivre.com.br') || url.includes('mercadolibre.com');
    const isAmazon = url.includes('amazon.com.br');
    let result: ProductData = { title: '', price: '', image_url: '' };

    // Step 1: Always try HTML scraping (extract whatever we can)
    try {
      const html = await fetchHTML(url);
      console.log('HTML length:', html.length);

      if (html.length > 1000) {
        result = extractFromHTML(html);
        console.log('HTML extract:', JSON.stringify({
          title: result.title?.substring(0, 60),
          price: result.price,
          has_image: !!result.image_url
        }));
      }
    } catch (e) {
      console.log('HTML fetch error:', e);
    }

    const badTitles = ['Preferências de cookies', 'Robot Check', 'Mercado Livre', 'Mercado Libre', ''];

    // Step 2: For ML, try API for image if missing, and URL for title fallback
    if (isML) {
      if (!result.image_url) {
        const apiImage = await fetchMLImage(url);
        if (apiImage) {
          result.image_url = apiImage;
          console.log('Got image from ML API');
        }
      }
      if (badTitles.includes(result.title)) {
        const mlData = extractFromMLUrl(url);
        if (mlData.title) result.title = mlData.title;
      }
    }

    // Step 3: For Amazon, extract title from URL if HTML failed
    if (isAmazon && badTitles.includes(result.title)) {
      const amzData = extractFromAmazonUrl(url);
      result.title = amzData.title || result.title;
    }

    // Clean bad titles
    if (result.title === 'Preferências de cookies' || result.title === 'Robot Check') {
      result.title = '';
    }

    console.log('Final:', JSON.stringify({
      title: result.title?.substring(0, 80),
      price: result.price,
      has_image: !!result.image_url
    }));

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
