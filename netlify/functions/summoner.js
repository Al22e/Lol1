* netlify/functions/summoner.js
 * Equivalente a /api/summoner pero en formato Netlify Functions.
 * Recibe un Riot ID (gameName + tagLine) y una plataforma, y devuelve el
 * PUUID del invocador usando Account-V1. Corre en el servidor de Netlify,
 * nunca en el navegador: es la única pieza que conoce la API key de Riot
 * (guardada como variable de entorno RIOT_API_KEY en el dashboard de
 * Netlify), así que la key nunca queda expuesta en el código que ve quien
 * visite la página.
 *
 * Con el netlify.toml de este mismo paquete, se llama igual que antes:
 * GET /api/summoner?gameName=Nombre&tagLine=TAG&platform=la1
 */

// Plataforma -> clúster regional que usan Account-V1 y Match-V5.
const PLATFORM_TO_CLUSTER = {
  na1: 'americas', br1: 'americas', la1: 'americas', la2: 'americas',
  euw1: 'europe', eun1: 'europe', ru: 'europe', tr1: 'europe',
  kr: 'asia', jp1: 'asia',
  oc1: 'sea', sg2: 'sea', tw2: 'sea', vn2: 'sea'
};

function json(statusCode, data) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  };
}

exports.handler = async (event) => {
  const { gameName, tagLine, platform } = event.queryStringParameters || {};

  if (!gameName || !tagLine || !platform) {
    return json(400, { error: 'Faltan parámetros (gameName, tagLine, platform).' });
  }

  const cluster = PLATFORM_TO_CLUSTER[String(platform).toLowerCase()];
  if (!cluster) {
    return json(400, { error: 'Región no reconocida.' });
  }

  const apiKey = process.env.RIOT_API_KEY;
  if (!apiKey) {
    return json(500, { error: 'Falta configurar RIOT_API_KEY en el servidor.' });
  }

  try {
    const url = `https://${cluster}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
    const riotRes = await fetch(url, { headers: { 'X-Riot-Token': apiKey } });

    if (riotRes.status === 404) {
      return json(404, { error: 'No existe ningún invocador con ese Nombre#TAG en esa región.' });
    }
    if (riotRes.status === 429) {
      return json(429, { error: 'Se alcanzó el límite de peticiones de la API key. Espera un momento.' });
    }
    if (!riotRes.ok) {
      return json(riotRes.status, { error: 'Riot API respondió con un error (' + riotRes.status + ').' });
    }

    const account = await riotRes.json();
    return json(200, {
      puuid: account.puuid,
      gameName: account.gameName,
      tagLine: account.tagLine,
      cluster,
      platform: String(platform).toLowerCase()
    });
  } catch (err) {
    return json(500, { error: 'No se pudo contactar a la API de Riot.' });
  }
};
