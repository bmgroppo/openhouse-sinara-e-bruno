const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

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

    console.log('Scraping URL:', url);

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

    // Extract title - try multiple sources
    let title = '';
    
    // og:title (highest priority)
    const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
    if (ogTitle) {
      title = ogTitle[1].trim();
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

    // Extract price
    let price = '';
    const pricePatterns = [
      // JSON-LD structured data
      /"price"\s*:\s*"?([\d]+[.,]?\d*)"?/,
      /"lowPrice"\s*:\s*"?([\d]+[.,]?\d*)"?/,
      // Brazilian format
      /R\$\s*([\d]{1,3}(?:\.?\d{3})*(?:,\d{2}))/,
      /class="[^"]*price[^"]*"[^>]*>(?:[^<]*?)R?\$?\s*([\d]{1,3}(?:\.?\d{3})*(?:,\d{2}))/i,
      /data-price=["']([\d.,]+)["']/i,
    ];
    for (const pattern of pricePatterns) {
      const match = html.match(pattern);
      if (match) {
        let p = match[1];
        // Convert Brazilian format (1.234,56) to standard (1234.56)
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

    // Extract image
    let image_url = '';
    const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (ogImage) image_url = ogImage[1];

    // Decode HTML entities
    title = title.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'");
    
    // Clean up title - remove site name suffixes
    title = title.replace(/\s*[-|–]\s*(Mercado Livre|Amazon|Shopee|Magazine Luiza|Americanas|Casas Bahia|Havan).*$/i, '');

    console.log('Extracted:', { title: title.substring(0, 50), price, image_url: image_url.substring(0, 50) });

    return new Response(JSON.stringify({ title, price, image_url }), {
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
