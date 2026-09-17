/* netlify/functions/top-champs.js
 * Equivalente a /api/top-champs pero en formato Netlify Functions.
 * Recibe el PUUID de un invocador (ya resuelto por /api/summoner), su
 * clúster regional y un rol (Top / Jungla / Medio / Tirador / Soporte),
 * revisa sus últimas partidas rankeadas con Match-V5 y devuelve sus
 * campeones más jugados específicamente en ese rol.
 *
 * GET /api/top-champs?puuid=...&cluster=americas&role=Medio&count=30
 */

const ROLE_TO_TEAM_POSITION = {
  Top: 'TOP',
  Jungla: 'JUNGLE',
  Medio: 'MIDDLE',
  Tirador: 'BOTTOM',
  Soporte: 'UTILITY'
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function json(statusCode, data) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  };
}

exports.handler = async (event) => {
  const { puuid, cluster, role, count } = event.queryStringParameters || {};

  if (!puuid || !cluster || !role) {
    return json(400, { error: 'Faltan parámetros (puuid, cluster, role).' });
  }

  const teamPosition = ROLE_TO_TEAM_POSITION[role];
  if (!teamPosition) {
    return json(400, { error: 'Rol no reconocido.' });
  }

  const apiKey = process.env.RIOT_API_KEY;
  if (!apiKey) {
    return json(500, { error: 'Falta configurar RIOT_API_KEY en el servidor.' });
  }

  // Tope de 40 partidas para no pasarse del límite de la API key de
  // desarrollo (20 peticiones/seg, 100 cada 2 min). Netlify además corta
  // las funciones normales a los 10s, así que conviene no pedir de más.
  const matchCount = Math.min(Math.max(parseInt(count, 10) || 30, 1), 40);

  try {
    const idsUrl = `https://${cluster}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=420&start=0&count=${matchCount}`;
    const idsRes = await fetch(idsUrl, { headers: { 'X-Riot-Token': apiKey } });

    if (idsRes.status === 429) {
      return json(429, { error: 'Se alcanzó el límite de peticiones de la API key. Espera un momento.' });
    }
    if (!idsRes.ok) {
      return json(idsRes.status, { error: 'No se pudo obtener el historial de partidas (' + idsRes.status + ').' });
    }

    const matchIds = await idsRes.json();
    if (!Array.isArray(matchIds) || matchIds.length === 0) {
      return json(200, { role, teamPosition, matchesScanned: 0, topChampions: [] });
    }

    const tally = {};
    let scanned = 0;

    // Se consulta cada partida una por una (con una pausa corta entre cada
    // request) para respetar el límite de la API key de desarrollo.
    for (const matchId of matchIds) {
      const matchUrl = `https://${cluster}.api.riotgames.com/lol/match/v5/matches/${matchId}`;
      const matchRes = await fetch(matchUrl, { headers: { 'X-Riot-Token': apiKey } });

      if (matchRes.status === 429) {
        await sleep(1200);
        continue;
      }
      if (!matchRes.ok) continue;

      const match = await matchRes.json();
      scanned += 1;
      const participant = match.info && match.info.participants
        ? match.info.participants.find((p) => p.puuid === puuid)
        : null;

      if (participant && participant.teamPosition === teamPosition) {
        tally[participant.championName] = (tally[participant.championName] || 0) + 1;
      }

      await sleep(60);
    }

    const topChampions = Object.entries(tally)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([championName, games]) => ({ championName, games }));

    return json(200, { role, teamPosition, matchesScanned: scanned, topChampions });
  } catch (err) {
    return json(500, { error: 'No se pudo contactar a la API de Riot.' });
  }
};
