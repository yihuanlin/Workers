const sharp = require('sharp');
const { put } = require('@vercel/blob');

const BING_API = 'https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=en-GB';

const getBingWallpaper = async () => {
    const response = await fetch(BING_API);
    const data = await response.json();
    const imageData = data.images[0];
    const imageUrl = `https://www.bing.com${imageData.url.replace('1920x1080', 'UHD')}`;
    const imageResponse = await fetch(imageUrl);
    const arrayBuffer = await imageResponse.arrayBuffer();

    const image = sharp(Buffer.from(arrayBuffer));
    const { width, height } = await image.metadata();
    const topRegionHeight = Math.floor(height * 0.05);
    const topBuffer = await image
        .resize({ width, height: topRegionHeight, position: 'top' })
        .toBuffer();
    const stats = await sharp(topBuffer).stats();
    const avgColor =
        '#' +
        [
            stats.channels[0].mean,
            stats.channels[1].mean,
            stats.channels[2].mean
        ]
            .map(c => Math.min(255, Math.max(0, Math.round(c))).toString(16).padStart(2, '0'))
            .join('');

    const webpBuffer = await sharp(Buffer.from(arrayBuffer))
        .webp({ quality: 80 })
        .toBuffer();

    const metadata = {
        title: imageData.title,
        link: imageData.copyrightlink,
        description: imageData.copyright,
        color: avgColor
    };

    return { image: webpBuffer, metadata };
};

module.exports = async (req, res) => {
    if (req.method === 'GET') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        try {
            if (req.query.type === 'image') {
                const response = await fetch('https://gqww27ubhjuwtdoc.public.blob.vercel-storage.com/wallpaper.webp');
                const imageBuffer = await response.arrayBuffer();
                res.setHeader('Content-Type', 'image/webp');
                res.send(Buffer.from(imageBuffer));
                return;
            } else {
                const response = await fetch('https://gqww27ubhjuwtdoc.public.blob.vercel-storage.com/metadata.json');
                const metadata = await response.json();
                res.status(200).json(metadata);
                return;
            }
        } catch {
            try {
                const { image, metadata } = await getBingWallpaper();
                Promise.all([
                    put('wallpaper.webp', image, { access: 'public', addRandomSuffix: false, contentType: 'image/webp' }),
                    put('metadata.json', JSON.stringify(metadata), { access: 'public', addRandomSuffix: false, contentType: 'application/json' })
                ]);
                if (req.query.type === 'image') {
                    res.setHeader('Content-Type', 'image/webp');
                    res.send(image);
                } else {
                    res.status(200).json(metadata);
                }
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        }
    }
    if (req.method === 'POST') {
        try {
            const { image, metadata } = await getBingWallpaper();
            Promise.all([
                put('wallpaper.webp', image, { access: 'public', addRandomSuffix: false, contentType: 'image/webp' }),
                put('metadata.json', JSON.stringify(metadata), { access: 'public', addRandomSuffix: false, contentType: 'application/json' })
            ]);
            res.status(200).json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }
};