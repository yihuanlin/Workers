export const config = { runtime: 'edge' };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET',
  'Content-Type': 'application/json',
  'Cache-Control': 'private, max-age=300, stale-while-revalidate=86400',
  'CDN-Cache-Control': 'no-store',
  'Vary': 'Accept-Encoding, Query'
};

export default async function handler(request, env = {}) {
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

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }

  if (request.methodm === 'GET') {
    let response, latitude, longitude, city, cleanedCity, ip;
    try {
      try {
        if (process.env.VERCEL === '1') {
          city = request.headers.get('x-vercel-ip-city')
          latitude = request.headers.get('x-vercel-ip-latitude')
          longitude = request.headers.get('x-vercel-ip-longitude')
          cleanedCity = city.replace(/(District|Province|County|City)\b/g, '').trim()
          if (!latitude || !longitude || !cleanedCity) {
            console.warn('Vercel: no geo data found')
            throw new Error()
          }
        } else if (request.cf) {
          ({ latitude, longitude, city } = request.cf)
          cleanedCity = city.replace(/(District|Province|County|City)\b/g, '').trim()
          if (!latitude || !longitude || !cleanedCity) {
            throw new Error()
          }
        } else if (request.headers.get('x-nf-geo') || env.geo) {
          ({ latitude, longitude, city } = JSON.parse(request.headers.get('x-nf-geo')) ? JSON.parse(request.headers.get('x-nf-geo')) : env.geo)
          cleanedCity = city.replace(/(District|Province|County|City)\b/g, '').trim()
          if (!latitude || !longitude || !cleanedCity) {
            console.warn('Netlify: no geo data found')
            throw new Error()
          }
        } else {
          throw new Error()
        }
      }
      catch {
        ip = request.headers.get('x-real-ip')
          || request.headers.get('x-nf-client-connection-ip')
          || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
          || request.socket?.remoteAddress
          || request.ip
        const geoResponse = await fetch(`https://api.ipgeolocation.io/ipgeo?apiKey=${process.env.IPGEO_KEY}&ip=${ip}`)
        if (!geoResponse.ok) {
          console.warn(await geoResponse.text())
          throw new Error()
        }
        const geoData = await geoResponse.json()
        latitude = geoData.latitude
        longitude = geoData.longitude
        cleanedCity = geoData.city.replace(/(District|Province|County|City)\b/g, '').trim()
        if (!latitude || !longitude || !cleanedCity) {
          console.warn('IPGeolocation: no geo data found')
          throw new Error()
        }
      }
      const weatherUrl = `https://api.openweathermap.org/data/3.0/onecall?lat=${latitude}&lon=${longitude}&units=metric&appid=${process.env.OPENWEATHER_API_KEY}`
      const weatherResponse = await fetch(weatherUrl)
      if (!weatherResponse.ok) {
        console.warn(await weatherResponse.text())
        throw new Error()
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
        }), { headers: corsHeaders }
      )
    } catch {
      try {
        ip = request.headers.get('x-real-ip')
          || request.headers.get('x-nf-client-connection-ip')
          || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
          || request.socket?.remoteAddress
          || request.ip
        const weatherApiResponse = await fetch(`https://api.weatherapi.com/v1/forecast.json?key=${process.env.WEATHERAPI_KEY}&q=${ip}&days=1`)
        if (!weatherApiResponse.ok) {
          console.warn(await weatherApiResponse.text())
          throw new Error()
        }
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
          }), { headers: corsHeaders }
        )
      } catch (fallbackError) {
        return new Response(
          JSON.stringify({ error: fallbackError }),
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

  return new Response('Method Not Allowed', {
    status: 405,
    headers: corsHeaders
  });
}
