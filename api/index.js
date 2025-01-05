export const config = { runtime: 'edge' };

export default async function handler(request) {
	const url = new URL(request.url);
	const searchParams = url.searchParams.toString();
	const redirectParams = searchParams ? `?${searchParams}` : '';
	return Response.redirect(`https://yhl.ac.cn${redirectParams}`, 301);
}
