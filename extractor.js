async function searchResults(keyword) {
    const results = [];
    const response = await fetch(`https://streamingcommunityz.institute/search?q=${keyword}`);
    const html = await response.text();

    const regex = /<a\s+href="([^"]+)"[^>]*>\s*<img[^>]+src="([^"]+)"[^>]+alt="([^"]+)"/g;

    let match;
    while ((match = regex.exec(html)) !== null) {
        const href = match[1].startsWith('http') ? match[1] : `https://streamingcommunityz.institute${match[1]}`;
        results.push({
            title: match[3].trim(),
            image: match[2].trim(),
            href: href
        });
    }

    return JSON.stringify(results);
}

async function extractDetails(url) {
    const results = [];
    const response = await fetch(url);
    const html = await response.text();

    const descriptionRegex = /<div[^>]+class="[^"]*plot[^"]*"[^>]*>([^<]+)<\/div>/i;
    const descriptionMatch = html.match(descriptionRegex);
    const description = descriptionMatch ? descriptionMatch[1].trim() : 'N/A';

    results.push({
        description: description,
        aliases: 'N/A',
        airdate: 'N/A'
    });

    return JSON.stringify(results);
}

async function extractEpisodes(url) {
    const results = [];
    const response = await fetch(url);
    const html = await response.text();

    const episodeRegex = /<a\s+href="([^"]+)"[^>]*>\s*(?:Episodio|Episode)\s+(\d+)/gi;

    let match;
    while ((match = episodeRegex.exec(html)) !== null) {
        const href = match[1].startsWith('http') ? match[1] : `https://streamingcommunityz.institute${match[1]}`;
        results.push({
            href: href,
            number: parseInt(match[2], 10)
        });
    }

    return JSON.stringify(results);
}

async function extractStreamUrl(url) {
    try {
        const response = await fetch(url);
        const html = await response.text();

        const iframeRegex = /<iframe[^>]+src="([^"]+)"/i;
        const iframeMatch = html.match(iframeRegex);
        
        if (!iframeMatch) return null;
        
        const iframeUrl = iframeMatch[1];
        const iframeResponse = await fetch(iframeUrl);
        const iframeHtml = await iframeResponse.text();

        const m3u8Regex = /(https?:\/\/[^\s"']+\.m3u8[^\s"']*)/i;
        const m3u8Match = iframeHtml.match(m3u8Regex);
        
        return m3u8Match ? m3u8Match[1].trim() : null;
    } catch (error) {
        console.error('Error:', error);
        return null;
    }
}
