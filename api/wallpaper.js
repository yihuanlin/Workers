import sharp from 'sharp';
import { put } from '@vercel/blob';
import { get } from '@vercel/edge-config';
import { waitUntil } from '@vercel/functions';

const EDGE_CONFIG = process.env.EDGE_CONFIG;
const API_TOKEN = process.env.VERCEL_API_TOKEN;
const BLOB_ID = process.env.BLOB_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;
const BING_API = 'https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=en-GB';
const EDGE_CONFIG_ID = !EDGE_CONFIG ? null : EDGE_CONFIG.match(/ecfg_[a-zA-Z0-9]+/)?.[0] ?? null;

const set = async (key, value) => {
	const response = await fetch(`https://api.vercel.com/v1/edge-config/${EDGE_CONFIG_ID}/items`, {
		method: 'PATCH',
		headers: {
			'Authorization': `Bearer ${API_TOKEN}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ items: [{ operation: 'upsert', key: key, value: value }] })
	});
	if (!response.ok) {
		throw new Error(`Failed to set edge config: ${await response.text()}`);
	}
	return response.json();
};

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
		if (!getCurrentFile.ok) {
			return {
				path: file.path,
				content: file.content,
				sha: null
			};
		}

		if (file.path.endsWith('.json')) {
			const currentContent = JSON.parse(Buffer.from(currentFile.content, 'base64').toString());
			const newContent = JSON.parse(Buffer.from(file.content, 'base64').toString());
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

const getAvgColor = (stats) => {
	return '#' + [0, 1, 2]
		.map(i => Math.min(255, Math.max(0, Math.round(stats.channels[i].mean))))
		.map(val => val.toString(16).padStart(2, '0'))
		.join('');
};

const getBingWallpaper = async () => {
	const response = await fetch(BING_API);
	const data = await response.json();
	const imageData = data.images[0];
	const imageUrl = `https://www.bing.com${imageData.url.replace('1920x1080', 'UHD')}`;
	const mobileImageUrl = `https://www.bing.com${imageData.url.replace('1920x1080', '1080x1920')}`;

	const [desktopImage, mobileImage] = await Promise.all([
		fetch(imageUrl)
			.then(r => r.arrayBuffer())
			.then(buffer => sharp(Buffer.from(buffer))),
		fetch(mobileImageUrl)
			.then(r => r.arrayBuffer())
			.then(buffer => sharp(Buffer.from(buffer)))
	]);

	const [{ width: dWidth, height: dHeight }, { width: mWidth, height: mHeight }] = await Promise.all([
		desktopImage.metadata(),
		mobileImage.metadata()
	]);

	const [desktopData, mobileData] = await Promise.all([
		desktopImage.toBuffer(),
		mobileImage.toBuffer()
	]);

	const [desktopResized, mobileResized] = await Promise.all([
		sharp(desktopData)
			.resize({ width: dWidth, height: Math.floor(dHeight * 0.05), position: 'top' })
			.toBuffer(),
		sharp(mobileData)
			.resize({ width: mWidth, height: Math.floor(mHeight * 0.05), position: 'top' })
			.toBuffer()
	]);

	const [desktopAvgColor, mobileAvgColor] = await Promise.all([
		sharp(desktopResized).stats().then(r => getAvgColor(r)),
		sharp(mobileResized).stats().then(r => getAvgColor(r))
	]);

	const [desktopWebpBuffer, mobileWebpBuffer] = await Promise.all([
		await sharp(Buffer.from(desktopData))
			.webp({ quality: 80 })
			.toBuffer(),
		await sharp(Buffer.from(mobileData))
			.webp({ quality: 80 })
			.toBuffer()
	]);

	const metadata = {
		title: imageData.title,
		link: imageData.copyrightlink,
		description: imageData.copyright,
		color: desktopAvgColor,
		mobileColor: mobileAvgColor,
	};

	return { image: desktopWebpBuffer, mobileImage: mobileWebpBuffer, metadata };
};

export default async (req, res) => {
	const date = new Date().toISOString().split('T')[0];
	if (req.method === 'GET') {
		res.setHeader('Access-Control-Allow-Origin', '*');
		try {
			if (req.query.type === 'image') {
				const response = await fetch(`https://${BLOB_ID}.public.blob.vercel-storage.com/wallpaper.webp`);
				const imageBuffer = await response.arrayBuffer();
				res.setHeader('Content-Type', 'image/webp');
				res.send(Buffer.from(imageBuffer));
			} else if (req.query.type === 'mobile') {
				const response = await fetch(`https://${BLOB_ID}.public.blob.vercel-storage.com/wallpaper-mobile.webp`);
				const imageBuffer = await response.arrayBuffer();
				res.setHeader('Content-Type', 'image/webp');
				res.send(Buffer.from(imageBuffer));
			} else {
				let metadata = await get('wallpaper-metadata');
				if (!metadata) {
					const response = await fetch(`https://${BLOB_ID}.public.blob.vercel-storage.com/metadata.json`);
					metadata = await response.json();
				}
				res.status(200).json(metadata);
			}
		} catch {
			try {
				const { image, mobileImage, metadata } = await getBingWallpaper();
				if (req.query.type === 'image') {
					res.setHeader('Content-Type', 'image/webp');
					res.send(image);
				} if (req.query.type === 'mobile') {
					res.setHeader('Content-Type', 'image/webp');
					res.send(mobileImage);
				} else {
					res.status(200).json(metadata);
				}
				waitUntil(Promise.all([
					put('wallpaper.webp', image, {
						access: 'public',
						addRandomSuffix: false,
						contentType: 'image/webp'
					}), put('metadata.json', JSON.stringify(metadata), {
						access: 'public',
						addRandomSuffix: false,
						contentType: 'application/json'
					}), put('wallpaper-mobile.webp', mobileImage, {
						access: 'public',
						addRandomSuffix: false,
						contentType: 'image/webp'
					}), set('wallpaper-metadata', metadata),
					uploadToGithub([
						{
							path: 'wallpaper.webp',
							content: image.toString('base64'),
						},
						{
							path: 'metadata.json',
							content: Buffer.from(JSON.stringify(metadata)).toString('base64'),
						},
						{
							path: 'wallpaper-mobile.webp',
							content: mobileImage.toString('base64'),
						}
					], `Update wallpaper and description for ${date}`)
				]));
			} catch (error) {
				res.status(500).json({ error: error.message });
			}
		}
	}
	if (req.method === 'POST') {
		try {
			const { image, mobileImage, metadata } = await getBingWallpaper();
			await Promise.all([
				put('wallpaper.webp', image, {
					access: 'public',
					addRandomSuffix: false,
					contentType: 'image/webp'
				}), put('metadata.json', JSON.stringify(metadata), {
					access: 'public',
					addRandomSuffix: false,
					contentType: 'application/json'
				}), put('wallpaper-mobile.webp', mobileImage, {
					access: 'public',
					addRandomSuffix: false,
					contentType: 'image/webp'
				}), set('wallpaper-metadata', metadata),
				uploadToGithub([
					{
						path: 'wallpaper.webp',
						content: image.toString('base64'),
					},
					{
						path: 'metadata.json',
						content: Buffer.from(JSON.stringify(metadata)).toString('base64'),
					},
					{
						path: 'wallpaper-mobile.webp',
						content: mobileImage.toString('base64'),
					}
				], `Update wallpaper and description for ${date}`)
			]);
			res.status(200).json({ success: true });
		} catch (error) {
			res.status(500).json({ error: error.message });
		}
	}
	return;
};
