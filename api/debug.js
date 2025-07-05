export const config = {
  runtime: 'edge',
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(request) {
  const body = await request.text();
  const headers = Object.fromEntries(request.headers);

  console.warn(`--- New ${request.method} Request ---`);
  console.warn('Headers:', JSON.stringify(headers, null, 2));
  console.warn('Body:', body);
  console.warn(`--- End of ${request.method} Request ---`);

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  if (request.method !== 'POST' && request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ success: true, message: 'Request logged' }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}