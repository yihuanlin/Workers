export const config = { runtime: 'edge' };

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET',
    'Access-Control-Allow-Headers': 'Content-Type'
};

const apiKey = process.env.GEMINI_API_KEY;

export default async function handler(req) {
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

    let searchValue, chatHistory = [];
    if (method === 'POST') {
        const body = await req.json();
        searchValue = body.searchValue;
        chatHistory = body.chatHistory || [];
    } else {
        const { searchParams } = new URL(req.url);
        searchValue = searchParams.get('q');
    }
    if (!searchValue) {
        return new Response(JSON.stringify({ error: 'Missing fields' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey
            },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        ...chatHistory.map(msg => ({ text: msg + '\n' })),
                        { text: `You are talking to a biologist who may ask biology-related or general questions. Current question: ${searchValue}\nAnswer ideally in a sentence.` }
                    ]
                }]
            })
        });

        const data = await response.json();
        return new Response(JSON.stringify({
            text: data.candidates[0]?.content.parts[0]?.text.replace(/\*(.*?)\*/g, '<i>$1</i>').trim()
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
