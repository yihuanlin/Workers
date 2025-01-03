export const config = { runtime: 'edge' };
import { geolocation } from '@vercel/functions';
const env = process.env;

export default async function handler(request) {
	const origin = request.headers.get('Origin');

	const isAllowed = !origin || origin.endsWith('yhl.ac.cn') || origin === 'file://';

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

	let response;
	try {
		const { latitude, longitude, city } = await geolocation(request)
		const cleanedCity = city.replace(/(District|Province|County|City)\b/g, '').trim()
		const weatherUrl = `https://api.openweathermap.org/data/3.0/onecall?lat=${latitude}&lon=${longitude}&units=metric&appid=${env.OPENWEATHER_API_KEY}`
		const weatherResponse = await fetch(weatherUrl, {
			next: { revalidate: 86400 }
		})
		if (!weatherResponse.ok) {
			throw new Error(`Weather service error: ${weatherResponse.status}`)
		}
		const weatherData = await weatherResponse.json()
		response = new Response(
			JSON.stringify({
				city: cleanedCity,
				temperature: Math.round(weatherData.current.temp),
				weather: weatherData.current.weather[0].main,
				description: weatherData.current.weather[0].description.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' '),
				code: parseInt(weatherData.current.weather[0].icon.toString().replace(/[dn]/g, '')),
				windSpeed: Math.round(weatherData.hourly[0].wind_speed * 3.6),
				rainChance: Math.round(weatherData.daily[0].pop),
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
	} catch {
		try {
			const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip');
			const weatherApiResponse = await fetch(`https://api.weatherapi.com/v1/forecast.json?key=${env.WEATHERAPI_KEY}&q=${ip}&days=1`)
			if (!weatherApiResponse.ok) throw new Error('Both weather APIs failed')

			const data = await weatherApiResponse.json()
			response = new Response(
				JSON.stringify({
					city: data.location.name,
					temperature: Math.round(data.current.temp_c),
					weather: null,
					description: data.current.condition.text,
					code: data.current.condition.code,
					windSpeed: Math.round(data.current.wind_kph),
					rainChance: data.current.humidity,
					sunrise: data.forecast.forecastday[0].astro.sunrise,
					sunset: data.forecast.forecastday[0].astro.sunset,
					maxTemperature: Math.round(data.forecast.forecastday[0].day.maxtemp_c),
					minTemperature: Math.round(data.forecast.forecastday[0].day.mintemp_c)
				}),
				{
					headers: {
						'Content-Type': 'application/json',
						'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400',
						'Access-Control-Allow-Origin': '*'
					}
				}
			)
		} catch (fallbackError) {
			return new Response(
				JSON.stringify({ error: 'Weather service unavailable' }),
				{
					status: 503,
					headers: {
						'Content-Type': 'application/json',
						'Access-Control-Allow-Origin': '*'
					}
				}
			)
		}
	}
	return response
}
