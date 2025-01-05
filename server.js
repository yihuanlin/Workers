import { createServer } from 'http';

const server = createServer(async (req, res) => {
	try {
		const fullUrl = `http://${req.headers.host}${req.url}`;
		const url = new URL(fullUrl);
		const path = url.pathname.slice(1) || 'index';

		const module = await import(`./api/${path}.js`);
		// Create request object similar to edge runtime
		const request = new Request(fullUrl, {
			method: req.method,
			headers: req.headers,
			body: req.method === 'POST' ? req : null
		});

		const response = await module.default(request);

		let responseBody = response.body;
		if (response.body instanceof ReadableStream) {
			responseBody = await response.text();
		}

		for (const [key, value] of Object.entries(response.headers)) {
			res.setHeader(key, value);
		}

		res.statusCode = response.status;
		res.end(responseBody);
	} catch (error) {
		console.error('Error:', error);
		res.statusCode = 500;
		res.setHeader('Content-Type', 'application/json');
		res.end(JSON.stringify({ error: 'Internal Server Error', details: error.message }));
	}
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
	console.log(`Server running on port ${port}`);
});