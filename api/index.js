import { geolocation } from '@vercel/functions';

export const config = {
    runtime: 'edge',
};

export default async function handler(request) {
    const { country } = await geolocation(request);

    const url = new URL(request.url);
    const searchParams = url.searchParams.toString();
    const redirectParams = searchParams ? `?${searchParams}` : '';

    if (country === 'CN') {
        return Response.redirect(`https://ve.yhl.ac.cn${redirectParams}`, 301);
    } else {
        return Response.redirect(`https://yhl.ac.cn${redirectParams}`, 301);
    }
}
