const axios = require('axios');
const sharp = require('sharp');
const fs = require('fs').promises;

const BING_API = 'https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1';

async function getBingWallpaper() {
    try {
        const response = await axios.get(BING_API);
        const imageData = response.data.images[0];
        const imageUrl = `https://www.bing.com${imageData.url}`;
        const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });

        const image = sharp(imageResponse.data);
        const { height } = await image.metadata();
        const topRegionHeight = Math.floor(height * 0.1);

        const stats = await image
            .extract({ left: 0, top: 0, width: null, height: topRegionHeight })
            .stats();

        const avgColor = {
            r: Math.round(stats.channels[0].mean),
            g: Math.round(stats.channels[1].mean),
            b: Math.round(stats.channels[2].mean)
        };

        const webpBuffer = await sharp(imageResponse.data)
            .webp({ quality: 80 })
            .toBuffer();

        const metadata = {
            title: imageData.title,
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
    // Handle GET requests to fetch saved data
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
        } catch (error) {
            res.status(404).json({ error: 'Files not found' });
            return;
        }
    }
    try {
        const { image, metadata } = await getBingWallpaper();
        await fs.writeFile('/tmp/wallpaper.webp', image);
        await fs.writeFile('/tmp/metadata.json', JSON.stringify(metadata, null, 2));
        res.status(200).json({ success: true, metadata });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

/*
Configuration and Usage Instructions:

1. Create vercel.json in project root:
{
    "version": 2,
    "crons": [{
        "path": "/api/wallpaper",
        "schedule": "0 0 * * *"
    }]
}

2. Required dependencies (package.json):
{
    "dependencies": {
        "axios": "^1.6.0",
        "sharp": "^0.32.6"
    }
}

3. API Endpoints:
   - GET /api/wallpaper?type=image - Returns the latest wallpaper image
   - GET /api/wallpaper - Returns the metadata JSON
   - POST /api/wallpaper - Triggers manual update (CRON job)

4. Deploy commands:
npm install
vercel deploy

Note: 
- Temporary files (/tmp/) are cleared periodically by Vercel
- Consider using Vercel Blob Storage for persistent storage
- Enable Cron jobs in Vercel project settings
*/