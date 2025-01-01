export const config = {
    runtime: 'edge'
};

export default async function handler(request, env) {
    const FEED_GROUPS = {
        development: 'https://journals.biologists.com/rss/site_1000005/1000005.xml',
        cell: [
            'https://www.cell.com/developmental-cell/current.rss',
            'https://www.cell.com/developmental-cell/inpress.rss',
            'https://www.cell.com/cell/current.rss',
            'https://www.cell.com/cell/inpress.rss',
            'https://www.cell.com/neuron/current.rss',
            'https://www.cell.com/neuron/inpress.rss',
            'https://www.cell.com/trends/neurosciences/current.rss',
            'https://www.cell.com/trends/neurosciences/inpress.rss',
            'https://www.cell.com/current-biology/current.rss',
            'https://www.cell.com/current-biology/inpress.rss'
        ],
        reviews: [
            'https://www.annualreviews.org/rss/content/journals/cellbio/latestarticles?fmt=rss',
            'https://www.annualreviews.org/rss/content/journals/neuro/latestarticles?fmt=rss'
        ],
        neuro: [
            'https://neuraldevelopment.biomedcentral.com/articles/most-recent/rss.xml',
            'https://www.eneuro.org/rss/ahead.xml'
        ],
        elife: [
            'https://elifesciences.org/rss/digests.xml',
            'https://elifesciences.org/rss/subject/developmental-biology.xml'
        ]
    };

    const getRandomFeed = () => {
        const feedKeys = Object.keys(FEED_GROUPS);
        const randomKey = feedKeys[Math.floor(Math.random() * feedKeys.length)];
        let selectedFeed = FEED_GROUPS[randomKey];
        if (Array.isArray(selectedFeed)) {
            selectedFeed = selectedFeed[Math.floor(Math.random() * selectedFeed.length)];
        }
        return selectedFeed;
    };

    const origin = request.headers['origin'] || request.headers['Origin'];
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
    let corsUrl = getRandomFeed();

    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Expose-Headers': '*',
        'Cache-Control': 'private, max-age=0, stale-while-revalidate=31536000'
    }

    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: corsHeaders,
        })
    }

    let attempts = 0;
    let text;
    let response;
    let items;
    let validItems = [];
    let corsRequest;
    const itemRegex = /<item[^>]*>[\s\S]*?<\/item>/g
    const descriptionRegex = /<description[^>]*>([\s\S]*?)<\/description>/
    const htmlEntitiesMap = {
        '&lt;': '<',
        '&gt;': '>'
    }

    while (attempts < 3) {
        corsRequest = new Request(corsUrl, {
            method: 'GET',
            redirect: 'follow'
        })

        try {
            response = await fetch(corsRequest);
            text = await response.text();
            items = text.match(itemRegex) || []
            validItems = items.filter(item => {
                const description = item.match(descriptionRegex)?.[1] || ''
                return description
                    .replace('ABSTRACT', '')
                    .replace(/&lt;|&gt;/g, match => htmlEntitiesMap[match])
                    .replace(/<[^>]+>/g, '')
                    .replace(/\s+/g, ' ')
                    .trim() !== ''
            })
            if (validItems.length > 0) {
                break;
            }
        } catch (error) {
            // Continue to next attempt
        }

        attempts++;
        if (attempts < 3) {
            corsUrl = getRandomFeed();
        } else {
            return new Response(JSON.stringify({ error: 'Failed to fetch feed after 3 attempts' }), {
                status: 502,
                headers: {
                    ...corsHeaders,
                    'Content-Type': 'application/json'
                }
            });
        }
    }

    const randomItem = validItems[Math.floor(Math.random() * validItems.length)]
    const getTagContent = (tag) => randomItem.match(new RegExp(`<${tag}[^>]*>(.*?)<\/${tag}>`, 's'))?.[1] || ''
    let title = getTagContent('title').replace(/\s+/g, ' ').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    title = (/[.!?]$/.test(title) ? title : title + '.').replace(/&lt;i&gt;(.*?)&lt;\/i&gt;/g, '<em>$1</em>')

    let description = getTagContent('description')
        .replace('ABSTRACT', '')
        .replace(']]>', '')
        .replace(/&lt;|&gt;/g, match => htmlEntitiesMap[match])
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    if (description.length > 200) {
        const geminiResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': env.GEMINI_API_KEY
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: `Summarize the abstract for "${title}" in concise academic style, do not include question and author information: ${description}`
                    }]
                }]
            })
        });
        const geminiData = await geminiResponse.json();
        const ai = { response: geminiData.candidates[0].content.parts[0].text };
        description = ai.response.replace(/\n/g, ' ').trim();
    }

    const result = {
        title: title,
        link: getTagContent('link').trim(),
        description: description
    }

    return new Response(JSON.stringify(result), {
        headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
        }
    });
}