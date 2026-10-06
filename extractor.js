/**
 * Shirox / Sora / Luna Module Extractor - StreamingCommunity IT
 * Versione: 1.0.3
 * 
 * Modifiche v1.0.3:
 * - Fix critico raggruppamento stagioni per detectSeasons() di Shirox
 * - Rimozione ordinamento numerico che generava stagioni con un solo episodio 1
 * - Caricamento sequenziale robusto delle stagioni (S1, S2, S3...)
 */

const CONFIG = {
  BASE: "https://streamingcommunityz.rip",
  CDN: "https://cdn.streamingcommunityz.rip/images/",
  LANG: "it",
  VERSION: "1.0.3",
  DEBUG: false, // impostare su true per visualizzare i log diagnostici
};

const MODULE_VERSION = CONFIG.VERSION;

// --- LOGGING & DIAGNOSTICA ---
function log(scope, ...args) {
  if (CONFIG.DEBUG) {
    console.log(`[SC-${CONFIG.VERSION}][${scope}]`, ...args);
  }
}

// --- UTILITY URL (Compatibili con JavaScriptCore iOS senza new URL) ---
function absUrl(href, base = CONFIG.BASE) {
  if (!href) return "";
  if (/^https?:\/\//i.test(href)) return href;
  const matchOrigin = base.match(/^https?:\/\/[^/]+/i);
  const origin = matchOrigin ? matchOrigin[0] : CONFIG.BASE;
  if (href.startsWith("//")) return origin.split(":")[0] + ":" + href;
  if (href.startsWith("/")) return origin + href;
  const dir = base.split(/[?#]/)[0].replace(/[^/]*$/, "");
  return dir + href;
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

// --- DECODIFICA HTML ENTITY ---
function decodeEntities(str = "") {
  const named = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
    agrave: "à", agrave: "à", egrave: "è", eacute: "é", igrave: "ì", ograve: "ò", ugrave: "ù"
  };
  return str.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return named[e.toLowerCase()] ?? m;
  });
}

const clean = (s) => decodeEntities(decodeEntities(s || "")).replace(/<[^>]+>/g, "").trim();

// --- GESTIONE FETCH ---
function isOk(res) {
  if (!res) return false;
  if (typeof res.status === "number") return res.status >= 200 && res.status < 400;
  return res.ok !== false;
}

async function soraFetch(url, options = {}) {
  const { headers = {}, method = "GET", body = null } = options;

  // Se l'app fornisce fetchv2 (Shirox con supporto Cloudflare / impersonate)
  if (typeof fetchv2 !== "undefined") {
    try {
      const res = await fetchv2(url, headers, method, body, { impersonate: "auto" });
      if (isOk(res)) return res;
      log("fetch", `HTTP ${res?.status} -> ${url}`);
      return null;
    } catch (e) {
      log("fetch", `fetchv2 eccezione -> fallback fetch -> ${url}`, e);
    }
  }

  // Fallback su fetch standard
  if (typeof fetch !== "undefined") {
    try {
      const res = await fetch(url, { headers, method, body });
      if (isOk(res)) return res;
      log("fetch", `HTTP ${res?.status} -> ${url}`);
      return null;
    } catch (e) {
      log("fetch", `fetch eccezione -> ${url}`, e);
      return null;
    }
  }

  log("fetch", "Nessun motore fetch disponibile!");
  return null;
}

async function fetchText(url, options) {
  const res = await soraFetch(url, options);
  return res ? await res.text() : null;
}

// --- CONCORRENZA LIMITATA ---
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i], i);
      } catch (e) {
        log("mapLimit", e);
        out[i] = null;
      }
    }
  });
  await Promise.all(workers);
  return out;
}

// --- PARSING INERTIA DATA-PAGE ---
function parseDataPage(html) {
  if (!html) return null;
  const match = html.match(/<div[^>]*id="app"[^>]*data-page="([^"]*)"/);
  if (!match || !match[1]) return null;
  try {
    const rawJson = decodeEntities(match[1]);
    return JSON.parse(rawJson);
  } catch (err) {
    log("parseDataPage", "JSON parse error", err);
    return null;
  }
}

// ==========================================
// 1. RICERCA CONTENUTI
// ==========================================
async function searchResults(keyword) {
  try {
    const searchUrl = `${CONFIG.BASE}/${CONFIG.LANG}/archive?search=${encodeURIComponent(keyword)}`;
    const html = await fetchText(searchUrl);
    if (!html) return JSON.stringify([]);

    const pageData = parseDataPage(html);
    const titles = pageData?.props?.titles || [];

    const results = titles
      .map((item) => {
        const posterImage = item.images?.find((img) => img.type === "poster");
        const imagePath = posterImage?.filename ? `${CONFIG.CDN}${posterImage.filename}` : "";
        return {
          title: clean(item.name),
          image: imagePath,
          href: `${CONFIG.BASE}/${CONFIG.LANG}/titles/${item.id}-${item.slug}`,
        };
      })
      .filter((item) => item.image && item.title);

    return JSON.stringify(results);
  } catch (error) {
    log("searchResults", "Error", error);
    return JSON.stringify([]);
  }
}

// ==========================================
// 2. DETTAGLI CONTENUTO
// ==========================================
async function extractDetails(url) {
  try {
    const baseUrl = url.replace(/\/season-\d+$/, "");
    const targetUrl = `${baseUrl}/season-1`;
    const html = await fetchText(targetUrl);
    if (!html) {
      return JSON.stringify([{ description: "N/A", aliases: "N/A", airdate: "N/A" }]);
    }

    const pageData = parseDataPage(html);
    const titleData = pageData?.props?.title;
    if (!titleData) {
      return JSON.stringify([{ description: "N/A", aliases: "N/A", airdate: "N/A" }]);
    }

    return JSON.stringify([{
      description: clean(titleData.plot) || "N/A",
      aliases: clean(titleData.original_name) || "N/A",
      airdate: titleData.release_date || "N/A",
    }]);
  } catch (error) {
    log("extractDetails", "Error", error);
    return JSON.stringify([{ description: "N/A", aliases: "N/A", airdate: "N/A" }]);
  }
}

// ==========================================
// 3. ESTRAZIONE EPISODI
// ==========================================
async function extractEpisodes(url) {
  try {
    const episodes = [];
    const baseUrl = url.replace(/\/season-\d+$/, "");

    // 1. Fetch prima stagione per ottenere id, totale stagioni ed episodi S1
    const s1Html = await fetchText(`${baseUrl}/season-1`);
    if (!s1Html) return JSON.stringify([]);

    const s1Data = parseDataPage(s1Html);
    const titleData = s1Data?.props?.title;
    if (!titleData) return JSON.stringify([]);

    const titleId = titleData.id;
    const totalSeasons = titleData.seasons_count || 1;

    // Episodi stagione 1
    const s1Episodes = s1Data?.props?.loadedSeason?.episodes || [];
    s1Episodes.forEach((ep) => {
      episodes.push({
        href: `${CONFIG.BASE}/${CONFIG.LANG}/iframe/${titleId}?episode_id=${ep.id}`,
        number: parseFloat(ep.number) || (episodes.length + 1),
      });
    });

    // 2. Se ci sono più stagioni, caricale sequenzialmente (S2, S3, S4...)
    // WebKitFetchEngine di Shirox esegue le richieste in sequenza ordinata
    for (let s = 2; s <= totalSeasons; s++) {
      try {
        const sHtml = await fetchText(`${baseUrl}/season-${s}`);
        if (sHtml) {
          const sData = parseDataPage(sHtml);
          const seasonEpisodes = sData?.props?.loadedSeason?.episodes || [];
          seasonEpisodes.forEach((ep) => {
            episodes.push({
              href: `${CONFIG.BASE}/${CONFIG.LANG}/iframe/${titleId}?episode_id=${ep.id}`,
              number: parseFloat(ep.number) || (episodes.length + 1),
            });
          });
        }
      } catch (err) {
        log("extractEpisodes", `Errore caricamento stagione ${s}`, err);
      }
    }

    // Se non ci sono episodi trovati (es. è un film singolo)
    if (episodes.length === 0) {
      episodes.push({
        href: `${CONFIG.BASE}/${CONFIG.LANG}/iframe/${titleId}`,
        number: 1,
      });
    }

    // IMPORTANTE PER SHIROX:
    // NON ordinare con .sort((a,b) => a.number - b.number)!
    // Shirox raggruppa le stagioni con detectSeasons(episodes) controllando:
    // 'if episodes[i].number <= episodes[i-1].number { seasons.append([]) }'
    // Gli episodi DEVONO rimanere nel loro ordine naturale per stagione:
    // [S1E1..S1E7, S2E1..S2E13, S3E1..S3E13...]
    // Se si fa un sort per numero, tutti gli episodi 1 finiscono consecutivi all'inizio
    // e Shirox crea una stagione separata per ciascun episodio mostrando solo "Episodio 1"!
    const seen = new Set();
    const normalized = episodes.filter((ep) => ep.href && !seen.has(ep.href) && seen.add(ep.href));

    return JSON.stringify(normalized);
  } catch (error) {
    log("extractEpisodes", "Error", error);
    return JSON.stringify([]);
  }
}

// ==========================================
// 4. ESTRAZIONE STREAM VIDEO (HLS ABR)
// ==========================================
async function extractStreamUrl(url) {
  try {
    let targetUrl = url;
    if (!targetUrl.includes(`/${CONFIG.LANG}/iframe`)) {
      targetUrl = targetUrl.replace("/iframe", `/${CONFIG.LANG}/iframe`);
    }

    const html = await fetchText(targetUrl);
    if (!html) return null;

    // 1. Estrai URL dell'iframe di embed (es. Vixcloud) e pulisci entità HTML (&amp; -> &)
    const iframeMatch = html.match(/<iframe[^>]*src="([^"]+)"/i);
    if (!iframeMatch || !iframeMatch[1]) {
      log("extractStreamUrl", "Iframe non trovato in:", targetUrl);
      return null;
    }

    const rawIframeSrc = decodeEntities(iframeMatch[1]);
    let iframeSrc = absUrl(rawIframeSrc, CONFIG.BASE);

    // 2. Verifica se è abilitato il Full HD dalla pagina genitore
    const canPlayFHD = /window\.canPlayFHD\s*=\s*(true|1)/i.test(html);
    if (canPlayFHD) {
      iframeSrc = withParams(iframeSrc, { h: 1 });
    }

    // 3. Scarica la pagina dell'iframe player di Vixcloud
    const playerHtml = await fetchText(iframeSrc, {
      headers: {
        "Referer": targetUrl,
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      },
    });
    if (!playerHtml) return null;

    // 4. Estrazione Master Playlist HLS da Vixcloud
    let streamUrl = null;

    // Metodo A: window.masterPlaylist (standard attuale Vixcloud con token HMAC e expires)
    const masterPlaylistMatch = playerHtml.match(/window\.masterPlaylist\s*=\s*({[\s\S]*?});/i);
    if (masterPlaylistMatch && masterPlaylistMatch[1]) {
      try {
        // Normalizza chiavi JS con o senza virgolette per parsing JSON
        const rawObj = masterPlaylistMatch[1]
          .replace(/'/g, '"')
          .replace(/(\w+)\s*:/g, '"$1":')
          .replace(/,\s*}/g, "}");
        const mpData = JSON.parse(rawObj);
        if (mpData.url) {
          streamUrl = withParams(absUrl(mpData.url, iframeSrc), mpData.params || {});
        }
      } catch (err) {
        // Fallback parsing manuale se JSON.parse fallisce su sintassi libera
        const urlMatch = masterPlaylistMatch[1].match(/url\s*:\s*['"]([^'"]+)['"]/i);
        const tokenMatch = masterPlaylistMatch[1].match(/['"]token['"]\s*:\s*['"]([^'"]+)['"]/i);
        const expiresMatch = masterPlaylistMatch[1].match(/['"]expires['"]\s*:\s*['"]([^'"]+)['"]/i);
        if (urlMatch && urlMatch[1]) {
          const params = {};
          if (tokenMatch && tokenMatch[1]) params.token = tokenMatch[1];
          if (expiresMatch && expiresMatch[1]) params.expires = expiresMatch[1];
          streamUrl = withParams(absUrl(urlMatch[1], iframeSrc), params);
        }
      }
    }

    // Metodo B: window.streams fallback (array di server)
    if (!streamUrl) {
      const streamsMatch = playerHtml.match(/window\.streams\s*=\s*(\[[\s\S]*?\]);/i);
      if (streamsMatch && streamsMatch[1]) {
        try {
          const cleanStreams = streamsMatch[1].replace(/\\\//g, "/");
          const streamsData = JSON.parse(cleanStreams);
          const activeStream = streamsData.find((s) => s.active) || streamsData[0];
          if (activeStream?.url) {
            streamUrl = absUrl(activeStream.url, iframeSrc);
          }
        } catch (e) {
          log("extractStreamUrl", "Errore parsing window.streams", e);
        }
      }
    }

    // Metodo C: pattern regex per URL .m3u8 o playlist
    if (!streamUrl) {
      const m3u8Match = playerHtml.match(/['"](https?:\/\/[^'"]+\.m3u8[^'"]*)['"]/i)
        || playerHtml.match(/source\s*:\s*['"]([^'"]+)['"]/i)
        || playerHtml.match(/file\s*:\s*['"]([^'"]+)['"]/i);

      if (m3u8Match && m3u8Match[1]) {
        streamUrl = absUrl(m3u8Match[1], iframeSrc);
      }
    }

    if (!streamUrl) {
      log("extractStreamUrl", "Nessuno stream .m3u8 / playlist identificato");
      return null;
    }

    // Se canPlayFHD è attivo, aggiungi il parametro se non già presente
    if (canPlayFHD && !streamUrl.includes("h=1")) {
      streamUrl = withParams(streamUrl, { h: 1 });
    }

    log("extractStreamUrl", "Stream individuato con successo:", streamUrl);

    // NOTA FONDAMENTALE: Restituiamo la MASTER PLAYLIST HLS direttamente!
    // Non forziamo getFixedResolutionM3u8 perché bloccare una singola variante (1080p)
    // disabilita l'Adaptive Bitrate (ABR) nativo di AVPlayer su iOS, provocando
    // "Playback stalled: couldn't keep buffering this stream" in caso di calo banda.
    // Inoltre restituisce tracce audio doppie (ITA/ENG) e sottotitoli.
    const streamObject = [{
      file: streamUrl,
      url: streamUrl,
      title: "StreamingCommunity",
      quality: "Auto (ABR)",
      headers: {
        "Referer": iframeSrc,
        "Origin": absUrl("/", iframeSrc),
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      },
    }];

    return JSON.stringify(streamObject);
  } catch (error) {
    log("extractStreamUrl", "Error", error);
    return null;
  }
}
