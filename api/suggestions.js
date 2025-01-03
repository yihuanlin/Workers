export const config = { runtime: 'edge' };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': '*',
  'Cache-Control': 'private, max-age=0, stale-while-revalidate=31536000'
};

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const origin = req.headers.get('origin') || req.headers.get('Origin');
  const method = req.method;
  const isAllowed = !origin || origin === 'file://' || origin.endsWith('yhl.ac.cn');

  if (method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (!isAllowed) {
    return new Response(JSON.stringify({ error: 'Access denied' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (method !== 'POST' && method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let searchValue, chatHistory = [];
  if (method === 'POST') {
    const body = await req.json();
    searchValue = body.searchValue;
    chatHistory = body.chatHistory || [];
  } else {
    searchValue = searchParams.get('q');
  }
  if (!searchValue) {
    return new Response(JSON.stringify({ error: 'Missing fields' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  const controller = new AbortController();
  const signal = controller.signal;

  req.signal.addEventListener('abort', () => {
    console.warn('Request abort detected');
    controller.abort();
  });

  signal.addEventListener('abort', () => {
    console.warn('Client disconnected');
  });
  const summary = searchParams.get('s');
  const gemini = summary && searchValue.length > 3
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const suggestionsUrl = `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(searchValue)}`;
        const geminiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

        const suggestionsPromise = fetch(suggestionsUrl, { signal })
          .then(r => r.json())
          .then(([, suggestions]) => {
            return controller.enqueue(
              encoder.encode(
                JSON.stringify({ keys: suggestions, isGemini: false })
              )
            );
          });

        const geminiPromise = gemini
          ? fetch(geminiUrl, {
            method: 'POST',
            signal,
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': process.env.GEMINI_API_KEY
            },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    ...chatHistory.map(msg => ({ text: msg + '\n' })),
                    {
                      text: `You are talking to a biologist who may ask biology-related or general questions. Current question: ${searchValue}\nAnswer ideally in a sentence.`
                    }
                  ]
                }
              ]
            })
          })
            .then(r => r.json())
            .then(geminiResult => {
              const geminiResponse = geminiResult.candidates[0]?.content.parts[0]?.text.replace(/\*(.*?)\*/g, '<em>$1</em>').trim() || '';
              return controller.enqueue(
                encoder.encode(
                  JSON.stringify({ text: geminiResponse, isGemini: true })
                )
              );
            })
          : null;

        await Promise.all([
          suggestionsPromise,
          gemini ? new Promise(resolve => setTimeout(() => resolve(geminiPromise), 300)) : null
        ]);
      } catch (error) {
        if (error.name === 'AbortError') {
        } else {
          controller.enqueue(encoder.encode(JSON.stringify({ error: error.message, isGemini: false })));
        }
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Transfer-Encoding': 'chunked'
    }
  });
}
