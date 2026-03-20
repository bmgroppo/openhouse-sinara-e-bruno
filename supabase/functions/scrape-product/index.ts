const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface ProductData {
  title: string;
  price: string;
  image_url: string;
}

// Extract ML item ID from URL
function extractMLItemId(url: string): string | null {
  // Pattern: MLB-1234567890 or MLB1234567890
  const m = url.match(/ML[AB]-?(\d+)/i);
  if (m) return `MLB${m[1]}`;
  
  // Pattern: /p/MLB12345678
  const p = url.match(/\/p\/(MLB\d+)/i);
  if (p) return p[1];
  
  return null;
}

// Use ML public API to get product data
async function fetchFromMLApi(itemId: string): Promise<ProductData | null> {
  try {
    console.log('Trying ML API for item:', itemId);
    const response = await fetch(`https://api.mercadolibre.com/items/${itemId}`, {
      headers: { 'Accept': 'application/json' },
    });
    
    if (!response.ok) {
      console.log('ML API returned:', response.status);
      const body = await response.text();
      console.log('ML API body:', body.substring(0, 200));
      return null;
    }
    
    const data = await response.json();
    console.log('ML API success, title:', data.title?.substring(0, 60));
    
    let image_url = '';
    if (data.pictures && data.pictures.length > 0) {
      // Use secure_url or url from first picture
      image_url = data.pictures[0].secure_url || data.pictures[0].url || '';
    } else if (data.thumbnail) {
      // Fallback to thumbnail, upgrade to larger size
      image_url = data.thumbnail.replace(/-I\.jpg/, '-O.jpg');
    }
    
    return {
      title: data.title || '',
      price: data.price?.toString() || '',
      image_url,
    };
  } catch (e) {
    console.log('ML API error:', e);
    return null;
  }
}

// Fetch HTML with browser-like headers
async function fetchHTML(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'identity',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Ch-Ua': '"Chromium";v="126", "Google Chrome";v="126", "Not-A.Brand";v="8"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
    },
    redirect: 'follow',
  });
  return response.text();
}

function extractFromHTML(html: string): ProductData {
  let title = '';
  let price = '';
  let image_url = '';

  // 1. JSON-LD structured data (works great for Amazon, Havan, Shopee)
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

  // 2. og:title meta tag
  if (!title) {
    const m = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
    if (m) title = m[1].trim();
  }

  // 3. <title> tag
  if (!title) {
    const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (m) title = m[1].trim();
  }

  // 4. Amazon-specific: productTitle span
  if (!title || title.includes('Amazon')) {
    const m = html.match(/id=["']productTitle["'][^>]*>\s*([^<]+)/i);
    if (m && m[1].trim().length > 5) title = m[1].trim();
  }

  // 5. Price patterns
  if (!price) {
    const patterns = [
      // Amazon price patterns
      /class="a-price-whole"[^>]*>([\d.]+)<.*?class="a-price-fraction"[^>]*>(\d+)</is,
      /"price"\s*:\s*"?([\d]+[.,]?\d*)"?/,
      /"lowPrice"\s*:\s*"?([\d]+[.,]?\d*)"?/,
      /itemprop=["']price["'][^>]*content=["']([\d.,]+)["']/i,
      /R\$\s*(?:<[^>]*>)*\s*([\d]{1,3}(?:\.?\d{3})*(?:,\d{2}))/,
      /data-price=["']([\d.,]+)["']/i,
      /"priceAmount"\s*:\s*"?([\d]+[.,]?\d*)"?/,
    ];
    for (const pattern of patterns) {
      const m = html.match(pattern);
      if (m) {
        let p = m[2] ? `${m[1]}.${m[2]}` : m[1]; // Handle Amazon whole+fraction
        if (p.includes(',')) p = p.replace(/\./g, '').replace(',', '.');
        const num = parseFloat(p);
        if (!isNaN(num) && num > 0 && num < 1000000) {
          price = num.toString();
          break;
        }
      }
    }
  }

  // 6. og:image
  if (!image_url) {
    const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (m) image_url = m[1];
  }

  // 7. Amazon main image
  if (!image_url) {
    const m = html.match(/id=["']landingImage["'][^>]*src=["']([^"']+)["']/i)
      || html.match(/id=["']imgBlkFront["'][^>]*src=["']([^"']+)["']/i)
      || html.match(/"hiRes"\s*:\s*"([^"]+)"/);
    if (m) image_url = m[1];
  }

  // 8. Amazon data-a-dynamic-image
  if (!image_url) {
    const m = html.match(/data-a-dynamic-image=["']\{([^}]+)\}/i);
    if (m) {
      const imgMatch = m[1].match(/"(https:\/\/[^"]+)"/);
      if (imgMatch) image_url = imgMatch[1];
    }
  }

  // Clean title - remove store names
  title = title.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'");
  title = title.replace(/\s*[-|–]\s*(Mercado Livre|Amazon\.com\.br|Amazon|Shopee|Magazine Luiza|Americanas|Casas Bahia|Havan|Submarino).*$/i, '');
  title = title.trim();

  return { title, price, image_url };
}

// Extract data from URL slug as last resort
function extractFromURLSlug(url: string): ProductData {
  let title = '';
  
  // Try ML slug pattern: /product-name-_JM
  const mlSlug = url.match(/\.com\.br\/([^/?#]+?)(?:-_JM|\/p)/);
  if (mlSlug) {
    title = mlSlug[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
  
  // Amazon: /dp/ with title in URL
  if (!title) {
    const amzSlug = url.match(/amazon\.com\.br\/([^/]+)\/dp\//);
    if (amzSlug) {
      title = decodeURIComponent(amzSlug[1]).replace(/-/g, ' ');
    }
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
    let result: ProductData | null = null;

    // === Strategy 1: ML Public API (most reliable for ML) ===
    if (isML) {
      const itemId = extractMLItemId(url);
      if (itemId) {
        result = await fetchFromMLApi(itemId);
        if (result?.title) {
          console.log('SUCCESS via ML API');
        }
      }
    }

    // === Strategy 2: HTML scraping ===
    if (!result || !result.title) {
      try {
        const html = await fetchHTML(url);
        console.log('HTML length:', html.length);
        
        // Check if we got a real page or a block page
        const isBlocked = html.includes('Preferências de cookies') || 
                          html.includes('challenge') ||
                          html.length < 5000;
        
        if (!isBlocked) {
          const htmlResult = extractFromHTML(html);
          if (htmlResult.title && !htmlResult.title.includes('Preferências')) {
            // Merge: prefer API data but fill in gaps from HTML
            if (result) {
              result.title = result.title || htmlResult.title;
              result.price = result.price || htmlResult.price;
              result.image_url = result.image_url || htmlResult.image_url;
            } else {
              result = htmlResult;
            }
            console.log('Got data from HTML scraping');
          }
        } else {
          console.log('Page appears blocked, skipping HTML extraction');
        }
      } catch (e) {
        console.log('HTML fetch failed:', e);
      }
    }

    // === Strategy 3: URL slug fallback ===
    if (!result || !result.title) {
      const slugData = extractFromURLSlug(url);
      if (slugData.title) {
        result = result || { title: '', price: '', image_url: '' };
        result.title = result.title || slugData.title;
        console.log('Used URL slug fallback for title');
      }
    }

    result = result || { title: '', price: '', image_url: '' };
    
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
