const sharp = require('sharp');
const fs = require('fs').promises;

const BING_API = 'https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=en-GB';

const getBingWallpaper = async () => {
    try {
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
            .resize({ width: width, height: topRegionHeight, position: 'top' })
            .toBuffer();
        const stats = await sharp(topBuffer).stats();
        const avgColor = '#' + [
            Math.min(255, Math.max(0, Math.round(stats.channels[0].mean))),
            Math.min(255, Math.max(0, Math.round(stats.channels[1].mean))),
            Math.min(255, Math.max(0, Math.round(stats.channels[2].mean)))
        ].map(x => x.toString(16).padStart(2, '0')).join('');

        const webpBuffer = await sharp(Buffer.from(arrayBuffer))
            .webp({ quality: 80 })
            .toBuffer();

        const metadata = {
            title: imageData.title,
            link: imageData.copyrightlink,
            description: imageData.copyright,
            date: imageData.startdate,
            color: avgColor
        };

        return {
            image: webpBuffer,
            metadata
        };
    } catch (error) {
        console.error('Error:', error);
        throw error;
    }
}

module.exports = async (req, res) => {
    if (req.method === 'GET') {
        try {
            if (req.query.type === 'image') {
                const image = await fs.readFile('/tmp/wallpaper.webp');
                res.setHeader('Content-Type', 'image/webp');
                res.send(image);
                return;
            } else {
                const metadata = await fs.readFile('/tmp/metadata.json', 'utf-8');
                res.status(200).json(JSON.parse(metadata));
                return;
            }
        } catch {
            try {
                const { image, metadata } = await getBingWallpaper();
                await fs.writeFile('/tmp/wallpaper.webp', image);
                await fs.writeFile('/tmp/metadata.json', JSON.stringify(metadata, null, 2));
                if (req.query.type === 'image') {
                    res.setHeader('Content-Type', 'image/webp');
                    res.send(image);
                    return;
                } else {
                    res.status(200).json(metadata);
                    return;
                }
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        }
    }
    if (req.method === 'POST') {
        try {
            const { image, metadata } = await getBingWallpaper();
            await fs.writeFile('/tmp/wallpaper.webp', image);
            await fs.writeFile('/tmp/metadata.json', JSON.stringify(metadata, null, 2));
            res.status(200).json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
        return;
    }
};