/**
 * Shirox / Sora / Luna Module Extractor - StreamingCommunity IT
 * Versione: 1.0.8
 *
 * Novità v1.0.8:
 * - soraFetch ritenta fino a 3 volte (pausa 1 s, 2 s) se la rete fallisce o il server
 *   risponde 5xx/429/408, entro ~50 s (Shirox concede 120 s a ogni funzione del modulo)
 *
 * Novità v1.0.6:
 * - Cache in RAM (TTL 15s) condivisa tra extractDetails ed extractEpisodes:
 *   viene salvata la richiesta in corso, quindi funziona anche se le due funzioni partono insieme
 * - Stagioni S2..Sn scaricate a gruppi (max SEASON_CONCURRENCY in parallelo) con ordine naturale garantito
 * - Estrazione token/expires/url isolata nel blocco window.masterPlaylist
 * - decodeEntities gestisce tutte le forme dell'apostrofo (&#39; &#039; &#x27; &apos;)
 */

const CONFIG = {
  BASE: "https://streamingcommunityz.build",
  CDN: "https://cdn.streamingcommunityz.build/images/",
  LANG: "it",
};

// Quante stagioni scaricare contemporaneamente (1 = sequenziale come v1.0.5).
// Se Shirox dà problemi o Cloudflare blocca, abbassare a 2 o 1.
const SEASON_CONCURRENCY = 3;

// Cache leggera per evitare la doppia richiesta di season-1 (Details + Episodes)
const CACHE_TTL = 15000; // 15 secondi
let PAGE_CACHE = { url: "", promise: null, timestamp: 0 };

// --- UTILITY ---
function decodeEntities(str = "") {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&#0*39;|&#x0*27;|&apos;/gi, "'")
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

// Esegue fn su ogni elemento con al massimo `limit` operazioni in parallelo.
// I risultati restano nello stesso ordine degli elementi (necessario per detectSeasons).
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length).fill(null);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = await fn(items[i], i);
      } catch (error) {
        results[i] = null; // Ignora eventuale errore sulla singola stagione
      }
    }
  }
  const workers = [];
  for (let w = 0; w < Math.min(Math.max(limit, 1), items.length); w++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

// --- FETCH ENGINE COMPATIBILE SHIROX / SORA ---
// Rete debole o sito sovraccarico: una richiesta fallita o con errore del server viene ritentata,
// invece di arrivare a Shirox come stream/lista vuota al primo errore.
// Il limite di tempo resta sotto i 120 s che Shirox concede a ogni funzione del modulo.
const FETCH_ATTEMPTS = 3;
const FETCH_TIME_BUDGET_MS = 50000;

async function soraFetch(url, options = { headers: {}, method: "GET", body: null }) {
  const started = Date.now();
  let res = null;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    res = await soraFetchOnce(url, options);
    if (res && !(res.status >= 500 || res.status === 429 || res.status === 408)) return res;
    if (attempt === FETCH_ATTEMPTS || Date.now() - started > FETCH_TIME_BUDGET_MS) break;
    console.log(`[soraFetch] tentativo ${attempt} fallito (${res ? res.status : "rete"}), riprovo: ${url}`);
    await sleep(1000 * attempt);
  }
  return res;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function soraFetchOnce(url, options) {
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

// Scarica la pagina e restituisce il JSON Inertia.js contenuto in data-page
async function fetchInertiaPageData(url) {
  const response = await soraFetch(url);
  if (!response) return null;
  const html = await response.text();
  const match = /<div[^>]*id="app"[^>]*data-page="([^"]*)"/.exec(html);
  if (!match || !match[1]) return null;

  // Solo &quot; prima del parse: decodeEntities va applicato DOPO, sui singoli campi
  return JSON.parse(match[1].replace(/&quot;/g, '"'));
}

// Come fetchInertiaPageData, ma con useCache=true riusa la richiesta (anche se ancora in corso)
async function getInertiaPageData(url, useCache = false) {
  if (!useCache) return fetchInertiaPageData(url);

  const now = Date.now();
  if (PAGE_CACHE.url === url && PAGE_CACHE.promise && now - PAGE_CACHE.timestamp < CACHE_TTL) {
    return PAGE_CACHE.promise;
  }

  const promise = fetchInertiaPageData(url).then(
    (data) => {
      if (!data && PAGE_CACHE.promise === promise) PAGE_CACHE = { url: "", promise: null, timestamp: 0 };
      return data;
    },
    (error) => {
      if (PAGE_CACHE.promise === promise) PAGE_CACHE = { url: "", promise: null, timestamp: 0 };
      throw error;
    }
  );
  PAGE_CACHE = { url, promise, timestamp: now };
  return promise;
}

// ==========================================
// 1. RICERCA
// ==========================================
async function searchResults(keyword) {
  try {
    const pageData = await getInertiaPageData(
      `${CONFIG.BASE}/${CONFIG.LANG}/archive?search=${encodeURIComponent(keyword)}`
    );
    const titles = pageData?.props?.titles || [];

    const results = titles
      .map((item) => {
        const posterImage = item.images?.find((img) => img.type === "poster");
        return {
          title: decodeEntities(item.name || ""),
          image: posterImage?.filename ? `${CONFIG.CDN}${posterImage.filename}` : "",
          href: `${CONFIG.BASE}/${CONFIG.LANG}/titles/${item.id}-${item.slug}`,
        };
      })
      .filter((item) => item.image && item.title);

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
    const pageData = await getInertiaPageData(`${baseUrl}/season-1`, true);
    const titleData = pageData?.props?.title;
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

    // Riusa la richiesta di extractDetails se è appena partita/terminata
    const pageData = await getInertiaPageData(`${baseUrl}/season-1`, true);
    const titleData = pageData?.props?.title;
    if (!titleData) return JSON.stringify([]);

    const titleId = titleData.id;
    const totalSeasons = titleData.seasons_count || 1;
    let hasEpisodes = false;

    const pushEpisodes = (epList) => {
      if (!Array.isArray(epList) || epList.length === 0) return;
      hasEpisodes = true;
      epList.forEach((episode) => {
        episodes.push({
          href: `${CONFIG.BASE}/${CONFIG.LANG}/iframe/${titleId}?episode_id=${episode.id}`,
          number: episode.number || episodes.length + 1,
        });
      });
    };

    // Episodi stagione 1 (già presenti nel primo fetch)
    pushEpisodes(pageData.props?.loadedSeason?.episodes);

    // Stagioni S2..Sn a gruppi di SEASON_CONCURRENCY, risultati nell'ordine [S2, S3, ...]
    if (totalSeasons > 1) {
      const seasonUrls = [];
      for (let season = 2; season <= totalSeasons; season++) {
        seasonUrls.push(`${baseUrl}/season-${season}`);
      }

      const seasonsData = await mapWithConcurrency(seasonUrls, SEASON_CONCURRENCY, (sUrl) =>
        getInertiaPageData(sUrl, false)
      );

      for (const sData of seasonsData) {
        if (sData) pushEpisodes(sData.props?.loadedSeason?.episodes);
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

    const iframeMatch = html1.match(/<iframe[^>]*src=['"]([^'"]+)['"]/i);
    if (!iframeMatch) return null;

    // Decodifica entità HTML (&amp; -> &) dall'attributo src
    const embedUrl = decodeEntities(iframeMatch[1]).replace(/amp;/g, "");

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
      // Cerca url/token/expires solo da window.masterPlaylist fino alla fine del suo <script>
      // (Vixcloud non chiude il blocco con "};", quindi non si usa una regex sulle graffe)
      const blockStart = html2.indexOf("window.masterPlaylist");
      const blockEnd = html2.indexOf("</script>", blockStart);
      const targetSource = html2.slice(blockStart, blockEnd === -1 ? undefined : blockEnd);

      const urlMatch = targetSource.match(/url:\s*['"]([^'"]+)['"]/);
      const tokenMatch = targetSource.match(/['"]?token['"]?\s*:\s*['"]([^'"]+)['"]/);
      const expiresMatch = targetSource.match(/['"]?expires['"]?\s*:\s*['"]([^'"]+)['"]/);

      if (urlMatch && tokenMatch && expiresMatch) {
        const base = urlMatch[1];
        const token = tokenMatch[1];
        const expires = expiresMatch[1];
        const canPlayFHD = /window\.canPlayFHD\s*=\s*(true|1)/i.test(html2);

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
