/**
 * Shirox / Sora / Luna Module Extractor - StreamingCommunity IT
 * Versione: 1.0.4
 * 
 * Basato sul codice originale funzionante con:
 * - Dominio aggiornato (.rip) e CDN immagini centralizzati
 * - Estrazione stagioni in ordine naturale (compatibile con detectSeasons di Shirox)
 * - extractStreamUrl restituisce direttamente la stringa dell'URL Master Playlist (compatibile con JSEngine.swift)
 */

const CONFIG = {
  BASE: "https://streamingcommunityz.rip",
  CDN: "https://cdn.streamingcommunityz.rip/images/",
  LANG: "it",
};

// --- UTILITY ---
function decodeEntities(str = "") {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function withParams(url, params) {
  if (!url) return "";
  const [main, hash = ""] = url.split("#");
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  if (!qs) return url;
  const sep = main.includes("?") ? (main.endsWith("?") || main.endsWith("&") ? "" : "&") : "?";
  return main + sep + qs + (hash ? "#" + hash : "");
}

// --- FETCH ENGINE COMPATIBILE SHIROX / SORA ---
async function soraFetch(url, options = { headers: {}, method: "GET", body: null }) {
  try {
    return await fetchv2(url, options.headers ?? {}, options.method ?? "GET", options.body ?? null);
  } catch (e) {
    try {
      return await fetch(url, options);
    } catch (error) {
      return null;
    }
  }
}

// ==========================================
// 1. RICERCA
// ==========================================
async function searchResults(keyword) {
  try {
    const response = await soraFetch(
      `${CONFIG.BASE}/${CONFIG.LANG}/archive?search=${encodeURIComponent(keyword)}`
    );
    if (!response) return JSON.stringify([]);
    const html = await response.text();
    const regex = /<div[^>]*id="app"[^>]*data-page="([^"]*)"/;
    const match = regex.exec(html);
    if (!match || !match[1]) return JSON.stringify([]);

    const dataPage = match[1].replace(/&quot;/g, '"');
    const pageData = JSON.parse(dataPage);
    const titles = pageData.props?.titles || [];

    const results = titles
      .map((item) => {
        const posterImage = item.images?.find((img) => img.type === "poster");
        return {
          title: decodeEntities(item.name || ""),
          image: posterImage?.filename ? `${CONFIG.CDN}${posterImage.filename}` : "",
          href: `${CONFIG.BASE}/${CONFIG.LANG}/titles/${item.id}-${item.slug}`,
        };
      })
      .filter((item) => item.image && item.title) || [];

    return JSON.stringify(results);
  } catch (error) {
    return JSON.stringify([]);
  }
}

// ==========================================
// 2. DETTAGLI
// ==========================================
async function extractDetails(url) {
  try {
    const baseUrl = url.replace(/\/season-\d+$/, "");
    const response = await soraFetch(`${baseUrl}/season-1`);
    if (!response) return JSON.stringify([]);
    const html = await response.text();
    const regex = /<div[^>]*id="app"[^>]*data-page="([^"]*)"/;
    const match = regex.exec(html);
    if (!match || !match[1]) return JSON.stringify([]);

    const dataPage = match[1].replace(/&quot;/g, '"');
    const pageData = JSON.parse(dataPage);
    const titleData = pageData.props?.title;
    if (!titleData) return JSON.stringify([]);

    return JSON.stringify([{
      description: decodeEntities(titleData.plot || "N/A"),
      aliases: decodeEntities(titleData.original_name || "N/A"),
      airdate: titleData.release_date || "N/A",
    }]);
  } catch (error) {
    return JSON.stringify([]);
  }
}

// ==========================================
// 3. EPISODI
// ==========================================
async function extractEpisodes(url) {
  try {
    const episodes = [];
    const baseUrl = url.replace(/\/season-\d+$/, "");

    // Scarica la stagione 1 per ottenere id e numero totale di stagioni
    const response = await soraFetch(`${baseUrl}/season-1`);
    if (!response) return JSON.stringify([]);
    const html = await response.text();
    const regex = /<div[^>]*id="app"[^>]*data-page="([^"]*)"/;
    const match = regex.exec(html);
    if (!match || !match[1]) return JSON.stringify([]);

    const pageData = JSON.parse(match[1].replace(/&quot;/g, '"'));
    const titleData = pageData.props?.title;
    if (!titleData) return JSON.stringify([]);

    const titleId = titleData.id;
    const totalSeasons = titleData.seasons_count || 1;

    // Aggiungi episodi stagione 1
    const s1Episodes = pageData.props?.loadedSeason?.episodes || [];
    let hasEpisodes = false;
    if (s1Episodes.length > 0) {
      hasEpisodes = true;
      s1Episodes.forEach((episode) => {
        episodes.push({
          href: `${CONFIG.BASE}/${CONFIG.LANG}/iframe/${titleId}?episode_id=${episode.id}`,
          number: episode.number || episodes.length + 1,
        });
      });
    }

    // Scarica le altre stagioni in ordine sequenziale (S2, S3...)
    for (let season = 2; season <= totalSeasons; season++) {
      try {
        const seasonResponse = await soraFetch(`${baseUrl}/season-${season}`);
        if (seasonResponse) {
          const seasonHtml = await seasonResponse.text();
          const seasonMatch = regex.exec(seasonHtml);
          if (seasonMatch && seasonMatch[1]) {
            const seasonData = JSON.parse(seasonMatch[1].replace(/&quot;/g, '"'));
            const seasonEpisodes = seasonData.props?.loadedSeason?.episodes || [];
            if (seasonEpisodes.length > 0) {
              hasEpisodes = true;
              seasonEpisodes.forEach((episode) => {
                episodes.push({
                  href: `${CONFIG.BASE}/${CONFIG.LANG}/iframe/${titleId}?episode_id=${episode.id}`,
                  number: episode.number || episodes.length + 1,
                });
              });
            }
          }
        }
      } catch (error) {
        // Ignora eventuale errore sulla singola stagione
      }
    }

    // Se non ci sono episodi (es. film singolo)
    if (!hasEpisodes) {
      episodes.push({
        href: `${CONFIG.BASE}/${CONFIG.LANG}/iframe/${titleId}`,
        number: 1,
      });
    }

    // IMPORTANTE: NON ordinare per number!
    // Shirox rileva le stagioni con detectSeasons: quando number <= previous.number crea una nuova stagione.
    // L'ordine naturale [S1E1..S1En, S2E1..S2En] garantisce il corretto raggruppamento delle stagioni nell'app.
    return JSON.stringify(episodes);
  } catch (error) {
    return JSON.stringify([]);
  }
}

// ==========================================
// 4. ESTRAZIONE STREAM (URL DIRETTO PER SHIROX)
// ==========================================
async function extractStreamUrl(url) {
  try {
    let modifiedUrl = url;
    if (!modifiedUrl.includes(`/${CONFIG.LANG}/iframe`)) {
      modifiedUrl = modifiedUrl.replace("/iframe", `/${CONFIG.LANG}/iframe`);
    }

    const response1 = await soraFetch(modifiedUrl);
    if (!response1) return null;
    const html1 = await response1.text();

    const iframeMatch = html1.match(/<iframe[^>]*src="([^"]*)"/);
    if (!iframeMatch) return null;

    // Decodifica entità HTML (&amp; -> &) dall'attributo src
    const embedUrl = iframeMatch[1].replace(/&amp;/g, "&").replace(/amp;/g, "");

    const response2 = await soraFetch(embedUrl, {
      headers: {
        "Referer": modifiedUrl,
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      },
    });
    if (!response2) return null;
    const html2 = await response2.text();

    let finalUrl = null;

    // Estrazione Master Playlist Vixcloud (HLS ABR nativo)
    if (html2.includes("window.masterPlaylist")) {
      const urlMatch = html2.match(/url:\s*['"]([^'"]+)['"]/);
      const tokenMatch = html2.match(/['"]?token['"]?\s*:\s*['"]([^'"]+)['"]/);
      const expiresMatch = html2.match(/['"]?expires['"]?\s*:\s*['"]([^'"]+)['"]/);

      if (urlMatch && tokenMatch && expiresMatch) {
        const base = urlMatch[1];
        const token = tokenMatch[1];
        const expires = expiresMatch[1];
        const canPlayFHD = /window\.canPlayFHD\s*=\s*(true|1)/.test(html2);

        const params = { token: token, expires: expires };
        if (canPlayFHD) params.h = 1;

        finalUrl = withParams(base, params);
      }
    }

    // Fallback: cerca URL m3u8 esplicito
    if (!finalUrl) {
      const m3u8Match = html2.match(/(https?:\/\/[^'"\s]+\.m3u8[^'"\s]*)/);
      if (m3u8Match) {
        finalUrl = m3u8Match[1];
      }
    }

    // Shirox (JSEngine+Streams.swift) richiede direttamente la stringa dell'URL
    return finalUrl || null;
  } catch (error) {
    return null;
  }
}
