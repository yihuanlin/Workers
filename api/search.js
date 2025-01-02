export const config = { runtime: 'edge' };

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET',
    'Content-Type': 'application/json'
};

export default async function handler(req, res) {
    const origin = req.headers.get('origin') || req.headers.get('Origin');
    const method = req.method;
    const isAllowed = !origin || origin === 'file://' || origin.endsWith('yhl.ac.cn');

    if (!isAllowed) {
        return new Response(JSON.stringify({ error: 'Access denied' }), {
            status: 403,
            headers: corsHeaders
        });
    }
    if (method === 'OPTIONS') {
        return new Response(null, { status: 200, headers: corsHeaders });
    }

    if (method === 'GET') {
        const { searchParams } = new URL(req.url);
        const searchValue = searchParams.get('q');

        if (!searchValue) {
            return new Response(JSON.stringify({ error: 'Missing fields' }), {
                status: 400,
                headers: corsHeaders
            });
        }
        const data = await fetch(`https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(searchValue)}`)
            .then(r => r.json())
            .then(([, suggestions]) => {
                return suggestions;
            });

        return new Response(JSON.stringify({
            keys: data || ''
        }), {
            headers: corsHeaders
        });
    }
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: corsHeaders
    });
}
