export const config = { runtime: 'edge' };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-cache, must-revalidate',
  'Vary': 'Accept-Encoding, Query'
};

export default async function handler(request) {
  const origin = request.headers.get('origin') || request.headers.get('Origin');
  const userAgent = request.headers.get('user-agent');
  const isAllowed = (!origin || origin == 'file://' ||
    origin.endsWith('yhl.ac.cn')) &&
    userAgent !== 'Fastly/cache-check';

  if (!isAllowed) {
    return new Response(JSON.stringify({ error: 'Access denied' }), {
      status: 403,
      headers: corsHeaders
    });
  }

  const method = request.method;

  if (method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (method === 'GET') {
    const { searchParams } = new URL(request.url);
    const searchValue = searchParams.get('q');

    if (!searchValue) {
      return new Response(JSON.stringify({ error: 'Missing fields' }), {
        status: 400,
        headers: corsHeaders
      });
    }
    const data = await fetch(
      `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(searchValue)}`,
      {
        headers: {
          'Accept-Charset': 'UTF-8',
          'Accept': 'application/json; charset=utf-8',
          'User-Agent': 'Mozilla/5.0'
        }
      }
    )
      .then(async r => {
        const text = await r.text();
        return JSON.parse(text);
      })
      .then(([, suggestions]) => suggestions);

    return new Response(JSON.stringify({
      keys: data || ''
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json; charset=utf-8'
      }
    });
  }
  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: corsHeaders
  });
}
