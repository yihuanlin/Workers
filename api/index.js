export const config = {
    runtime: 'edge',
};

export default async function handler(request) {
    const origin = request.headers.get('Origin');

    const isAllowed = !origin || origin == 'https://dash.cloudflare.com' ||
        origin.endsWith('yhl.ac.cn');

    if (!isAllowed) {
        return new Response(
            JSON.stringify({ error: `Access denied` }),
            {
                status: 403,
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );
    }

    const url = new URL(request.url);
    const corsUrl = url.searchParams.get('url');

    if (!corsUrl) {
        return new Response('Missing URL parameter', { status: 400 });
    }

    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Expose-Headers': '*',
        'Cache-Control': 'private, max-age=0, stale-while-revalidate=31536000'
    };

    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: corsHeaders,
        });
    }

    const corsRequest = new Request(corsUrl, {
        method: request.method,
        headers: request.headers,
        body: request.method !== 'GET' ? request.body : null,
        redirect: 'follow'
    });

    const response = await fetch(corsRequest);

    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders }
    });
}