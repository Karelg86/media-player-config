/**
 * Test runner locale per extractor.js (Node.js 18+)
 *
 * Uso:
 *   node test-module.js "interstellar"      -> test LIVE sul sito vero (search, details, episodes, stream)
 *   node test-module.js "breaking bad"      -> serie TV: controlla anche le stagioni
 *   node test-module.js --mock              -> test OFFLINE con pagine finte (non tocca internet)
 *
 * extractor.js viene caricato in un contesto isolato, come fa Shirox con JavaScriptCore.
 * fetchv2 non esiste in Node: soraFetch usa automaticamente fetch come fallback.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const EXTRACTOR_PATH = process.env.EXTRACTOR || path.join(__dirname, "extractor.js");

function loadExtractor(fetchImpl) {
  const context = vm.createContext({
    fetch: fetchImpl,
    console,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(fs.readFileSync(EXTRACTOR_PATH, "utf8"), context, { filename: "extractor.js" });
  return context;
}

let failures = 0;
function check(label, condition, detail = "") {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? "  ->  " + detail : ""}`);
  if (!condition) failures++;
}

// ==========================================
// TEST LIVE
// ==========================================
async function runLive(keyword) {
  const ex = loadExtractor(fetch);
  console.log(`\n🔎 Test LIVE con "${keyword}"\n`);

  const results = JSON.parse(await ex.searchResults(keyword));
  check("search", results.length > 0, `${results.length} risultati`);
  if (results.length === 0) return;
  const first = results[0];
  console.log(`   primo risultato: ${first.title}\n   ${first.href}`);

  const details = JSON.parse(await ex.extractDetails(first.href));
  check("details", details.length === 1 && details[0].description !== "N/A",
    details[0] ? details[0].description.slice(0, 80) + "..." : "vuoto");

  const t0 = Date.now();
  const episodes = JSON.parse(await ex.extractEpisodes(first.href));
  check("episodes", episodes.length > 0, `${episodes.length} episodi in ${Date.now() - t0} ms`);
  if (episodes.length === 0) return;

  // Ricostruisce le stagioni come fa detectSeasons di Shirox
  const seasons = [[episodes[0]]];
  for (let i = 1; i < episodes.length; i++) {
    if (episodes[i].number <= episodes[i - 1].number) seasons.push([]);
    seasons[seasons.length - 1].push(episodes[i]);
  }
  console.log(`   stagioni viste da Shirox: ${seasons.length} -> [${seasons.map((s) => s.length).join(", ")}] episodi`);

  const stream = await ex.extractStreamUrl(episodes[0].href);
  check("stream", typeof stream === "string" && stream.startsWith("http"), stream || "null");
  if (stream) {
    check("stream contiene token ed expires", /token=/.test(stream) && /expires=/.test(stream));
    check("nessun doppio '?' nell'URL", (stream.match(/\?/g) || []).length <= 1);
  }
}

// ==========================================
// TEST OFFLINE (MOCK)
// ==========================================
const MOCK_BASE = "https://streamingcommunityz.shiksha";
const MOCK_SEASONS = 6;
const MOCK_EPISODES_PER_SEASON = 3;

function inertiaHtml(pageObj) {
  // Come Laravel: JSON dentro l'attributo data-page con &quot; e apostrofi &#039;
  const attr = JSON.stringify(pageObj).replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  return `<html><body><div id="app" data-page="${attr}"></div></body></html>`;
}

function makeMockFetch(stats) {
  return async (url) => {
    stats.requests.push(url);
    stats.inFlight++;
    stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
    await new Promise((r) => setTimeout(r, 30));
    stats.inFlight--;

    let body = "";
    const seasonMatch = url.match(/\/titles\/42-test-serie\/season-(\d+)$/);
    if (url.includes("/archive?search=")) {
      body = inertiaHtml({
        props: { titles: [{ id: 42, slug: "test-serie", name: "L'esorcista", images: [{ type: "poster", filename: "p.jpg" }] }] },
      });
    } else if (seasonMatch) {
      const s = Number(seasonMatch[1]);
      body = inertiaHtml({
        props: {
          title: { id: 42, seasons_count: MOCK_SEASONS, plot: "Un prete e l'esorcismo", original_name: "The Exorcist", release_date: "1973-12-26" },
          loadedSeason: {
            episodes: Array.from({ length: MOCK_EPISODES_PER_SEASON }, (_, i) => ({ id: s * 100 + i + 1, number: i + 1 })),
          },
        },
      });
    } else if (url.includes("/it/iframe/42")) {
      body = `<html><iframe class='player' src='https://vixcloud.co/embed/999?token=abc&amp;b=1'></iframe></html>`;
    } else if (url.startsWith("https://vixcloud.co/embed/999")) {
      body = `<script>var tracker = { url: 'https://pubblicita.example/track' };</script>
<script>
  window.video = { id: 999 };
  window.masterPlaylist = {
    params: {
      'token': 'TOKEN123',
      'expires': '1999999999',
      'asn': '',
    },
    url: 'https://vixcloud.co/playlist/999?b=1',
  }
  window.canPlayFHD = TRUE
</script>
<script>var other = { 'token': 'SBAGLIATO', url: 'https://pubblicita.example/after' };</script>`;
    }
    return { text: async () => body };
  };
}

async function runMock() {
  console.log("\n🧪 Test OFFLINE (mock)\n");

  // decodeEntities
  const ex0 = loadExtractor(async () => null);
  for (const raw of ["L&#39;a", "L&#039;a", "L&#x27;a", "L&apos;a"]) {
    check(`decodeEntities("${raw}")`, ex0.decodeEntities(raw) === "L'a");
  }

  // Ricerca
  let stats = { requests: [], inFlight: 0, maxInFlight: 0 };
  let ex = loadExtractor(makeMockFetch(stats));
  const results = JSON.parse(await ex.searchResults("esorcista"));
  check("search: apostrofo decodificato", results[0] && results[0].title === "L'esorcista", results[0] && results[0].title);

  // Details + Episodes in contemporanea (come fa Shirox)
  stats = { requests: [], inFlight: 0, maxInFlight: 0 };
  ex = loadExtractor(makeMockFetch(stats));
  const href = `${MOCK_BASE}/it/titles/42-test-serie`;
  const [detailsJson, episodesJson] = await Promise.all([ex.extractDetails(href), ex.extractEpisodes(href)]);
  const details = JSON.parse(detailsJson);
  const episodes = JSON.parse(episodesJson);

  const season1Requests = stats.requests.filter((u) => u.endsWith("/season-1")).length;
  check("cache: season-1 scaricata una sola volta", season1Requests === 1, `${season1Requests} richieste`);
  check("details: trama decodificata", details[0] && details[0].description === "Un prete e l'esorcismo");

  const expectedTotal = MOCK_SEASONS * MOCK_EPISODES_PER_SEASON;
  check("episodes: numero totale", episodes.length === expectedTotal, `${episodes.length}/${expectedTotal}`);

  const ids = episodes.map((e) => Number(e.href.split("episode_id=")[1]));
  const expectedIds = [];
  for (let s = 1; s <= MOCK_SEASONS; s++) for (let i = 1; i <= MOCK_EPISODES_PER_SEASON; i++) expectedIds.push(s * 100 + i);
  check("episodes: ordine naturale S1..Sn", JSON.stringify(ids) === JSON.stringify(expectedIds));

  const maxSeasonParallel = stats.maxInFlight;
  check("episodes: max richieste in parallelo <= 3", maxSeasonParallel <= 3, `${maxSeasonParallel}`);

  // Stream
  stats = { requests: [], inFlight: 0, maxInFlight: 0 };
  ex = loadExtractor(makeMockFetch(stats));
  const stream = await ex.extractStreamUrl(`${MOCK_BASE}/iframe/42?episode_id=101`);
  check("stream: URL dal blocco masterPlaylist (non dallo script esterno)",
    stream === "https://vixcloud.co/playlist/999?b=1&token=TOKEN123&expires=1999999999&h=1", stream || "null");

  // Retry: errori temporanei del server/rete prima della risposta buona
  const flaky = (failures) => {
    const calls = {};
    const base = makeMockFetch({ requests: [], inFlight: 0, maxInFlight: 0 });
    const fetchImpl = async (url, options) => {
      calls[url] = (calls[url] || 0) + 1;
      const failure = failures[calls[url] - 1];
      if (failure === "rete") throw new Error("network down");
      if (failure) return { status: failure, text: async () => "" };
      return base(url, options);
    };
    return { calls, fetchImpl };
  };
  const streamUrl = `${MOCK_BASE}/iframe/42?episode_id=101`;
  const expected = "https://vixcloud.co/playlist/999?b=1&token=TOKEN123&expires=1999999999&h=1";

  let f = flaky([503]);
  ex = loadExtractor(f.fetchImpl);
  check("retry: 503 poi ok -> stream", (await ex.extractStreamUrl(streamUrl)) === expected,
    `richieste iframe: ${f.calls[`${MOCK_BASE}/it/iframe/42?episode_id=101`]}`);

  f = flaky(["rete"]);
  ex = loadExtractor(f.fetchImpl);
  check("retry: errore di rete poi ok -> stream", (await ex.extractStreamUrl(streamUrl)) === expected);

  f = flaky([404]);
  ex = loadExtractor(f.fetchImpl);
  await ex.extractStreamUrl(streamUrl);
  const tries404 = f.calls[`${MOCK_BASE}/it/iframe/42?episode_id=101`];
  check("retry: 404 non ritentato", tries404 === 1, `${tries404} richieste`);

  f = flaky([503, 503, 503, 503]);
  ex = loadExtractor(f.fetchImpl);
  const dead = await ex.extractStreamUrl(streamUrl);
  const tries503 = f.calls[`${MOCK_BASE}/it/iframe/42?episode_id=101`];
  check("retry: max 3 tentativi poi null", dead === null && tries503 === 3, `${tries503} richieste`);
}

// ==========================================
(async () => {
  const arg = process.argv[2];
  try {
    if (!arg) {
      console.log('Uso: node test-module.js "titolo"   oppure   node test-module.js --mock');
      process.exit(1);
    }
    if (arg === "--mock") await runMock();
    else await runLive(arg);
  } catch (error) {
    console.error("💥 Errore imprevisto:", error);
    failures++;
  }
  console.log(failures === 0 ? "\n🎉 Tutti i test superati\n" : `\n⚠️  ${failures} test falliti\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
