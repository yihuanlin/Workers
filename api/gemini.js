export const config = { runtime: 'edge' };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-cache, must-revalidate',
  'Vary': 'Accept-Encoding, Query'
};

export default async function handler(request, env = {}) {
  const origin = request.headers.get('origin') || request.headers.get('Origin');
  const userAgent = request.headers.get('user-agent');
  const isAllowed = (!origin || origin == 'file://' ||
    origin.endsWith('yhl.ac.cn')) &&
    userAgent !== 'Fastly/cache-check';

  if (!isAllowed) {
    return new Response(JSON.stringify({ error: 'Access denied' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const method = request.method;

  if (method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (method !== 'POST' && method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let searchValue, chatHistory = [];
  if (method === 'POST') {
    const body = await request.json();
    searchValue = body.searchValue;
    chatHistory = body.chatHistory || [];
  } else {
    const { searchParams } = new URL(request.url);
    searchValue = searchParams.get('q');
  }
  if (!searchValue) {
    return new Response(JSON.stringify({ error: 'Missing fields' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        contents: [{
          parts: [
            ...chatHistory.map(msg => ({ text: msg + '\n' })),
            { text: `You are engaging with a biologist who may ask questions related to biology or general topics. Respond concisely, ideally in a single sentence, while ensuring accuracy and clarity in your answers.\n Question: ${searchValue}` }
          ]
        }],
        tools: [{
          google_search: {}
        }]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error.message || 'Failed to fetch data from Gemini API');
    }

    const nonThoughtPart = data.candidates[0]?.content?.parts?.find(part => !part.thought);
    const responseText = nonThoughtPart?.text ? nonThoughtPart.text.replace(/\*(.*?)\*/g, '<em>$1</em>').trim() : '';

    return new Response(JSON.stringify({
      text: responseText,
      query: data.candidates[0]?.groundingMetadata?.webSearchQueries?.[0] || null
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  } catch (error) {
    console.warn(error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
}
