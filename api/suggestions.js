let currentAbortController = null;

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET',
    'Access-Control-Allow-Headers': 'Content-Type'
};

const env = process.env;

export default async function handler(req, res) {
    const origin = req.headers['origin'] || req.headers['Origin'];
    const isAllowed = !origin || origin == 'file://' ||
        origin.endsWith('yhl.ac.cn');
    const { method } = req;
    Object.entries(corsHeaders).forEach(([key, value]) => res.setHeader(key, value));

    if (!isAllowed) {
        return res.status(403).json({ error: 'Access denied' });
    }

    if (method === 'OPTIONS') {
        return res.writeHead(200, corsHeaders).end();
    }

    if (method === 'POST' || method === 'GET') {
        const url = req.url.startsWith('/') ? 'http://localhost' + req.url : req.url;
        const summary = new URL(url).searchParams.get('s');
        let searchValue, chatHistory;
        if (method === 'POST') {
            ({ searchValue, chatHistory } = req.body || {});
        } else {
            searchValue = new URL(url).searchParams.get('q');
            chatHistory = [];
        }
        if (!searchValue) return res.status(400).json({ error: 'Missing fields' });

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Transfer-Encoding', 'chunked');
        const encoder = new TextEncoder();
        if (currentAbortController) currentAbortController.abort();
        currentAbortController = new AbortController();
        const signal = currentAbortController.signal;

        const stream = new ReadableStream({
            async start(controller) {
                try {
                    const googlePromise = fetch(
                        `http://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(searchValue)}`,
                        { signal }
                    ).then(r => r.json())
                        .then(data => ({ type: 'google', data }));

                    const geminiPromise = summary ? fetch(
                        'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',
                        {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'x-goog-api-key': env.GEMINI_API_KEY
                            },
                            body: JSON.stringify({
                                contents: [{
                                    parts: [
                                        ...chatHistory.map(msg => ({ text: msg + "\n" })),
                                        {
                                            text: `You are talking to a biologist who may ask biology-related or general questions. Current question: ${searchValue}\nAnswer ideally in a sentence.`
                                        }
                                    ]
                                }]
                            }),
                            signal
                        }
                    ).then(r => r.json())
                        .then(data => ({ type: 'gemini', data }))
                        : null;

                    Promise.all([
                        googlePromise.then(result => {
                            const [, suggestions] = result.data;
                            controller.enqueue(encoder.encode(JSON.stringify({
                                suggestions,
                                isStreaming: true
                            })));
                            if (!summary) {
                                controller.close();
                                currentAbortController = null;
                            }
                        }),
                        geminiPromise?.then(result => {
                            controller.enqueue(encoder.encode(JSON.stringify({
                                analysis: result.data.candidates?.[0]?.content?.parts?.[0]?.text,
                                isStreaming: false
                            })));
                            controller.close();
                            currentAbortController = null;
                        })
                    ].filter(Boolean));
                } catch (error) {
                    if (error.name === 'AbortError') {
                        controller.enqueue(encoder.encode(JSON.stringify({
                            suggestions: [],
                            isStreaming: false
                        })));
                    } else {
                        controller.error(error);
                    }
                }
            }
        });

        stream.pipeTo(new WritableStream({
            write(chunk) {
                res.write(chunk);
            },
            close() {
                res.end();
            }
        }));
        return;
    }
    return res.status(405).json({ error: 'Method not allowed' });
}
