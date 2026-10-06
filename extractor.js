// ==========================================
// CONFIGURAZIONE CENTRALIZZATA
// ==========================================
const CONFIG = {
  BASE: "https://streamingcommunityz.rip",
  CDN: "https://cdn.streamingcommunityz.rip",
  LANG: "it",
  DEBUG: true,
  VERSION: "1.0.2"
};

function log(scope, ...args) {
  if (CONFIG.DEBUG) console.log(`[${scope}]`, ...args);
}

// ==========================================
// UTILITY STRINGHE & URL (NO DIPENDENZA new URL())
// ==========================================
function decodeEntities(str = "") {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return str.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return named[e.toLowerCase()] ?? m;
  });
}

const clean = (s) => decodeEntities(decodeEntities(s || "")).replace(/<[^>]+>/g, "").trim();

function withParams(url, params) {
  const [main, hash = ""] = url.split("#");
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  if (!qs) return url;
  const sep = main.includes("?") ? (main.endsWith("?") || main.endsWith("&") ? "" : "&") : "?";
  return main + sep + qs + (hash ? "#" + hash : "");
}

function toEpisodeNumber(raw, fallback) {
  const n = parseFloat(String(raw).replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

// ==========================================
// NETWORKING ROBUSTO (CON STATUS CHECK)
// ==========================================
function isOk(res) {
  if (!res) return false;
  if (typeof res.status === "number") return res.status >= 200 && res.status < 400;
  return res.ok !== false;
}

async function soraFetch(url, options = {}) {
  const { headers = {}, method = "GET", body = null } = options;

  if (typeof fetchv2 !== "undefined") {
    try {
      // In Shirox l'opzione { impersonate: 'auto' } attiva il bypass nativo di Cloudflare
      const res = await fetchv2(url, headers, method, body, { impersonate: "auto" });
      if (isOk(res)) return res;
      log("fetch", `HTTP ${res?.status} → ${url}`);
      return null;
    } catch (e) {
      log("fetch", `fetchv2 eccezione → ${url}`, e);
    }
  }

  try {
    const res = await fetch(url, { headers, method, body });
    if (isOk(res)) return res;
    log("fetch", `HTTP ${res.status} → ${url}`);
    return null;
  } catch (e) {
    log("fetch", `fetch eccezione → ${url}`, e);
    return null;
  }
}

async function fetchText(url, options) {
  const res = await soraFetch(url, options);
  return res ? await res.text() : null;
}

// ==========================================
// FUNZIONI PRINCIPALI DEL MODULO
// ==========================================
async function searchResults(keyword) {
  try {
    const searchUrl = `${CONFIG.BASE}/${CONFIG.LANG}/archive?search=${encodeURIComponent(keyword)}`;
    const html = await fetchText(searchUrl);
    if (!html) return JSON.stringify([]);

    const match = html.match(/<div[^>]*id="app"[^>]*data-page="([^"]*)"/);
    if (!match?.[1]) return JSON.stringify([]);

    const pageData = JSON.parse(match[1].replaceAll("&quot;", '"'));
    const titles = pageData.props?.titles || [];

    const results = titles
      .map((item) => {
        const posterImage = item.images?.find((img) => img.type === "poster");
        return {
          title: clean(item.name),
          image: posterImage?.filename ? `${CONFIG.CDN}/images/${posterImage.filename}` : "",
          href: `${CONFIG.BASE}/${CONFIG.LANG}/titles/${item.id}-${item.slug}`,
        };
      })
      .filter((item) => item.image);

    return JSON.stringify(results);
  } catch (error) {
    log("searchResults", error);
    return JSON.stringify([]);
  }
}

async function extractDetails(url) {
  try {
    const html = await fetchText(`${url}/season-1`);
    if (!html) return JSON.stringify([]);

    const match = html.match(/<div[^>]*id="app"[^>]*data-page="([^"]*)"/);
    if (!match?.[1]) return JSON.stringify([]);

    const pageData = JSON.parse(match[1].replaceAll("&quot;", '"'));
    const titleData = pageData.props?.title;
    if (!titleData) return JSON.stringify([]);

    return JSON.stringify([
      {
        description: clean(titleData.plot) || "N/A",
        aliases: clean(titleData.original_name) || "N/A",
        airdate: titleData.release_date || "N/A",
      },
    ]);
  } catch (error) {
    log("extractDetails", error);
    return JSON.stringify([]);
  }
}

async function extractEpisodes(url) {
  try {
    const episodes = [];
    const baseUrl = url.replace(/\/season-\d+$/, "");

    // Ottimizzazione review: scarica season-1 una sola volta
    const firstSeasonHtml = await fetchText(`${baseUrl}/season-1`);
    if (!firstSeasonHtml) return JSON.stringify([]);

    const match = firstSeasonHtml.match(/<div[^>]*id="app"[^>]*data-page="([^"]*)"/);
    if (!match?.[1]) return JSON.stringify([]);

    const pageData = JSON.parse(match[1].replaceAll("&quot;", '"'));
    const titleData = pageData.props?.title;
    if (!titleData) return JSON.stringify([]);

    const titleId = titleData.id;
    const totalSeasons = titleData.seasons_count || 1;
    let hasEpisodes = false;

    // Elabora season-1 già in memoria
    const s1Episodes = pageData.props?.loadedSeason?.episodes || [];
    if (s1Episodes.length > 0) {
      hasEpisodes = true;
      s1Episodes.forEach((ep) => {
        episodes.push({
          href: `${CONFIG.BASE}/${CONFIG.LANG}/iframe/${titleId}?episode_id=${ep.id}`,
          number: toEpisodeNumber(ep.number, episodes.length + 1),
        });
      });
    }

    // Scarica le stagioni successive dalla 2 in poi
    for (let season = 2; season <= totalSeasons; season++) {
      try {
        const seasonHtml = await fetchText(`${baseUrl}/season-${season}`);
        if (!seasonHtml) continue;

        const sMatch = seasonHtml.match(/<div[^>]*id="app"[^>]*data-page="([^"]*)"/);
        if (sMatch?.[1]) {
          const sData = JSON.parse(sMatch[1].replaceAll("&quot;", '"'));
          const sEpisodes = sData.props?.loadedSeason?.episodes || [];
          if (sEpisodes.length > 0) {
            hasEpisodes = true;
            sEpisodes.forEach((ep) => {
              episodes.push({
                href: `${CONFIG.BASE}/${CONFIG.LANG}/iframe/${titleId}?episode_id=${ep.id}`,
                number: toEpisodeNumber(ep.number, episodes.length + 1),
              });
            });
          }
        }
      } catch (err) {
        log("extractEpisodes", `Errore stagione ${season}:`, err);
      }
    }

    // Se è un film senza episodi
    if (!hasEpisodes) {
      episodes.push({ href: `${CONFIG.BASE}/${CONFIG.LANG}/iframe/${titleId}`, number: 1 });
    }

    // Deduplica e ordina per numero episodio
    const seen = new Set();
    const finalEpisodes = episodes
      .filter((ep) => ep.href && !seen.has(ep.href) && seen.add(ep.href))
      .sort((a, b) => a.number - b.number);

    return JSON.stringify(finalEpisodes);
  } catch (error) {
    log("extractEpisodes", error);
    return JSON.stringify([]);
  }
}

async function extractStreamUrl(url) {
  try {
    let modifiedUrl = url;
    if (!url.includes("/it/iframe") && !url.includes("/en/iframe")) {
      modifiedUrl = url.replace("/iframe", `/${CONFIG.LANG}/iframe`);
    }

    const html1 = await fetchText(modifiedUrl, {
      headers: { Referer: `${CONFIG.BASE}/` },
    });
    if (!html1) return null;

    const iframeMatch = html1.match(/<iframe[^>]*src="([^"]*)"/);
    if (!iframeMatch) return null;

    const embedUrl = iframeMatch[1].replaceAll("&amp;", "&");

    const html2 = await fetchText(embedUrl, {
      headers: { Referer: modifiedUrl },
    });
    if (!html2) return null;

    let finalUrl = null;
    if (html2.includes("window.masterPlaylist")) {
      const urlMatch = html2.match(/url:\s*['"]([^'"]+)['"]/);
      const tokenMatch = html2.match(/['"]?token['"]?\s*:\s*['"]([^'"]+)['"]/);
      const expiresMatch = html2.match(/['"]?expires['"]?\s*:\s*['"]([^'"]+)['"]/);

      if (urlMatch && tokenMatch && expiresMatch) {
        const base = urlMatch[1];
        const token = tokenMatch[1];
        const expires = expiresMatch[1];

        // Controllo sicuro FHD per evitare 403 Forbidden
        const canPlayFHD = /window\.canPlayFHD\s*=\s*(true|1)/i.test(html2);

        // Costruzione sicura con withParams: niente doppi ? o parametri malformati
        finalUrl = withParams(base, {
          token: token,
          expires: expires,
          ...(canPlayFHD ? { h: "1" } : {}),
        });
      }
    }

    if (!finalUrl) {
      const m3u8Match = html2.match(/(https?:\/\/[^'"\s]+\.m3u8[^'"\s]*)/);
      if (m3u8Match) finalUrl = m3u8Match[1];
    }

    // Ritorna direttamente la Master Playlist HLS con ABR (Adaptive Bitrate) nativo
    return finalUrl || null;
  } catch (error) {
    log("extractStreamUrl", error);
    return null;
  }
}
