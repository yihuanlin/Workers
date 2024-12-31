let GITHUB_TOKEN;
let GITHUB_REPO;

const handleSchedule = async env => {
    GITHUB_TOKEN = env.GITHUB_TOKEN;
    GITHUB_REPO = env.GITHUB_REPO;

    const response = await fetch("https://bing.biturl.top/?resolution=UHD&format=json&index=0&mkt=en-GB");
    const data = await response.json();
    const {
        url: imageUrl,
        copyright: description,
        copyright_link: link
    } = data;
    const date = new Date().toISOString().split('T')[0];
    const imageResponse = await fetch(imageUrl);
    const imageBuffer = await imageResponse.arrayBuffer();
    const uint8Array = new Uint8Array(imageBuffer);
    const chunks = [];
    const chunkSize = 0x8000;
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
        chunks.push(String.fromCharCode.apply(null, uint8Array.subarray(i, i + chunkSize)));
    }
    const imageBase64 = btoa(chunks.join(''));
    const descriptionData = {
        text: encodeURIComponent(description),
        link: link,
        date: date
    };
    const uploads = await uploadToGithub([
        {
            path: 'wallpaper.jpg',
            content: imageBase64,
        },
        {
            path: 'wallpaper.json',
            content: btoa(JSON.stringify(descriptionData)),
        }
    ], `Update wallpaper and description for ${date}`);

    return {
        image: uploads.find(u => u?.path === 'wallpaper.jpg') ? 'wallpaper.jpg updated' : 'wallpaper.jpg already exists',
        description: uploads.find(u => u?.path === 'wallpaper.json') ? 'wallpaper.json updated' : 'wallpaper.json already exists',
        status: 'success'
    };
}

const uploadToGithub = async (files, message) => {
    const updates = await Promise.all(files.map(async file => {
        const getCurrentFile = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${file.path}`, {
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'Wallpaper-Update-Bot'
            }
        });
        const currentFile = await getCurrentFile.json();
        if (file.path.endsWith('.json')) {
            const currentContent = JSON.parse(atob(currentFile.content.replace(/\n/g, '')));
            const newContent = JSON.parse(atob(file.content));
            if (currentContent.text === newContent.text &&
                currentContent.link === newContent.link) {
                return null;
            }
        } else {
            const blobResponse = await fetch(currentFile.git_url, {
                headers: {
                    'Authorization': `token ${GITHUB_TOKEN}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'User-Agent': 'Wallpaper-Update-Bot'
                }
            });
            const blob = await blobResponse.json();
            const content = blob.content;
            if (content.replace(/\n/g, '') === file.content) {
                return null;
            }
        }
        return {
            path: file.path,
            content: file.content,
            sha: currentFile.sha
        };
    }));

    const validUpdates = updates.filter(update => update !== null);
    if (validUpdates.length === 0) {
        return updates;
    }

    const treeFetch = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/git/trees/main`, {
        headers: {
            'Authorization': `token ${GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'Wallpaper-Update-Bot'
        }
    });
    const mainTree = await treeFetch.json();

    const blobPromises = validUpdates.map(file =>
        fetch(`https://api.github.com/repos/${GITHUB_REPO}/git/blobs`, {
            method: 'POST',
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'Wallpaper-Update-Bot'
            },
            body: JSON.stringify({
                content: file.content,
                encoding: 'base64'
            })
        }).then(res => res.json())
    );
    const blobs = await Promise.all(blobPromises);

    const treeResponse = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/git/trees`, {
        method: 'POST',
        headers: {
            'Authorization': `token ${GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'Wallpaper-Update-Bot'
        },
        body: JSON.stringify({
            base_tree: mainTree.sha,
            tree: validUpdates.map((file, index) => ({
                path: file.path,
                mode: '100644',
                type: 'blob',
                sha: blobs[index].sha
            }))
        })
    });
    const newTree = await treeResponse.json();

    const commitResponse = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/git/commits`, {
        method: 'POST',
        headers: {
            'Authorization': `token ${GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'Wallpaper-Update-Bot'
        },
        body: JSON.stringify({
            message: message,
            tree: newTree.sha,
            parents: [mainTree.sha]
        })
    });
    const newCommit = await commitResponse.json();

    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/git/refs/heads/main`, {
        method: 'PATCH',
        headers: {
            'Authorization': `token ${GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'Wallpaper-Update-Bot'
        },
        body: JSON.stringify({
            sha: newCommit.sha
        })
    });

    if (!response.ok) {
        const responseClone = response.clone();
        try {
            const errorData = await response.json();
            throw new Error(`GitHub API error: ${response.status} - ${errorData.message}`);
        } catch (e) {
            throw new Error(`GitHub API error: ${response.status} - ${await responseClone.text()}`);
        }
    }

    return updates;
}

export default {
    async scheduled(_, env) {
        try {
            await handleSchedule(env);
        } catch (error) {
            console.error('Schedule handler error:', error);
        }
    },
    async fetch(_, env) {
        try {
            const response = await handleSchedule(env);
            return new Response(JSON.stringify(response), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (error) {
            console.error(error);
            return new Response(JSON.stringify({
                status: 'error',
                message: error.message
            }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }
};
