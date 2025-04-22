export const config = { runtime: 'edge' };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-cache, must-revalidate',
  'Vary': 'Accept-Encoding, Query'
};

export default async function handler(req, env = {}) {
  const apiKey = process.env.GITHUB_TOKEN;
  const origin = req.headers.get('origin') || req.headers.get('Origin');
  const method = req.method;
  const isAllowed = !origin || origin === 'file://' || origin.endsWith('yhl.ac.cn');

  if (!isAllowed) {
    return new Response(JSON.stringify({ error: 'Access denied' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  if (method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (method !== 'POST' && method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let searchValue, chatHistory, model = [];
  if (method === 'POST') {
    const body = await req.json();
    searchValue = body.searchValue;
    model = body.model;
    chatHistory = body.chatHistory || [];
  } else {
    const { searchParams } = new URL(req.url);
    searchValue = searchParams.get('q');
    model = searchParams.get('m');
  }
  if (!searchValue) {
    return new Response(JSON.stringify({ error: 'Missing fields' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const response = await fetch('https://models.github.ai/inference/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        messages: [
          ...(chatHistory && chatHistory.chatHistory && chatHistory.chatHistory.length > 0 ? chatHistory.chatHistory.map(msg => ({ role: msg.startsWith('User:') ? 'user' : 'assistant', content: msg.substring(msg.indexOf(':') + 1).trim() })) : []),
          {
            role: 'user',
            content: `You are engaging with a biologist who may ask questions related to biology or general topics. Respond concisely, ideally in a single sentence, while ensuring accuracy and clarity in your answers.\n Question: ${searchValue}`
          }
        ],
        temperature: 1.0,
        top_p: 1.0,
        model: model && model.length > 0 ? model : 'openai/gpt-4.1'
      })
    });
    const data = await response.json();
    let content = data.choices[0].message.content;
    const thinkIndex = content.indexOf("</think>\n\n");
    if (thinkIndex !== -1) {
      content = content.substring(thinkIndex + "</think>\n\n".length);
    }
    const cleanedContent = content.trim();

    return new Response(JSON.stringify({
      text: cleanedContent,
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
}
