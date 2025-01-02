export const config = { runtime: 'edge' };

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET',
    'Access-Control-Allow-Headers': 'Content-Type'
};

let currentAbortController = null;

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

    const summary = searchParams.get('s');
    const encoder = new TextEncoder();
    if (currentAbortController) {
        currentAbortController.abort();
    }
    currentAbortController = new AbortController();
    const signal = currentAbortController.signal;

    const stream = new ReadableStream({
        async start(controller) {
            const promises = [];

            const suggestPromise = fetch(`http://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(searchValue)}`, { signal })
                .then(r => r.json())
                .then(([, suggestions]) => {
                    controller.enqueue(encoder.encode(JSON.stringify({
                        suggestions,
                        isStreaming: summary ? true : false
                    })));
                    if (!summary) {
                        controller.close();
                        currentAbortController = null;
                    }
                    return true;
                });
            promises.push(suggestPromise);

            if (summary && process.env.GEMINI_API_KEY) {
                const geminiPromise = fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-goog-api-key': process.env.GEMINI_API_KEY
                    },
                    body: JSON.stringify({
                        contents: [{
                            parts: [
                                ...chatHistory.map(msg => ({ text: msg + '\n' })),
                                { text: `You are talking to a biologist who may ask biology-related or general questions. Current question: ${searchValue}\nAnswer ideally in a sentence.` }
                            ]
                        }]
                    }),
                    signal
                })
                    .then(r => r.json())
                    .then(data => {
                        controller.enqueue(encoder.encode(JSON.stringify({
                            analysis: data.candidates[0]?.content.parts[0]?.text || '',
                            isStreaming: false
                        })));
                        controller.close();
                        currentAbortController = null;
                    });
                promises.push(geminiPromise);
            }
            await Promise.all(promises);
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
