export const config = {
    runtime: 'edge'
};

export default async function handler(request) {
    const env = process.env;
    const origin = request.headers.get('Origin');

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

    const cache = caches.default
    let response = await cache.match(request)
    if (response) return response

    const ip = request.headers.get('x-forwarded-for') || request.headers.get('cf-connecting-ip')
    const geoResponse = await fetch(`https://api.ipgeolocation.io/ipgeo?apiKey=${env.IPGEO_KEY}&ip=${ip}`)
    if (!geoResponse.ok) {
        return new Response(
            JSON.stringify({ error: 'Failed to fetch geolocation data' }),
            {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            }
        )
    }
    const geoData = await geoResponse.json()
    const latitude = geoData.latitude
    const longitude = geoData.longitude
    const city = geoData.city.replace(/(District|Province|County|City)\b/g, '').trim()
    const weatherUrl = `https://api.openweathermap.org/data/3.0/onecall?lat=${latitude}&lon=${longitude}&units=metric&appid=${env.OPENWEATHER_API_KEY}`
    const weatherResponse = await fetch(weatherUrl)
    if (!weatherResponse.ok) {
        throw new Error(`Weather service error: ${weatherResponse.status}`)
    }
    const weatherData = await weatherResponse.json()
    response = new Response(
        JSON.stringify({
            city: city,
            temperature: Math.round(weatherData.current.temp),
            weather: weatherData.current.weather[0].main,
            description: weatherData.current.weather[0].description.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' '),
            code: parseInt(weatherData.current.weather[0].icon.toString().replace(/[dn]/g, '')),
            windSpeed: weatherData.current.wind_speed * 3.6,
            rainChance: weatherData.daily[0].pop,
            sunrise: new Date(weatherData.current.sunrise * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }),
            sunset: new Date(weatherData.current.sunset * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }),
            maxTemperature: Math.round(weatherData.daily[0].temp.max),
            minTemperature: Math.round(weatherData.daily[0].temp.min)
        }),
        {
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400',
                'Access-Control-Allow-Origin': '*'
            }
        }
    )

    await cache.put(request, response.clone())
    return response
}
