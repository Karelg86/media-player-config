async function getVideoSource(url) {
  try {
    const response = await fetch(url);
    const html = await response.text();
    
    // Estrai iframe embed
    const iframeMatch = html.match(/iframe.*?src=["'](.*?)["']/);
    if (!iframeMatch) return null;
    
    const iframeUrl = iframeMatch[1];
    
    // Ottieni playlist m3u8
    const iframeResponse = await fetch(iframeUrl);
    const iframeHtml = await iframeResponse.text();
    
    const m3u8Match = iframeHtml.match(/(https?:\/\/[^\s"']+\.m3u8[^\s"']*)/);
    if (!m3u8Match) return null;
    
    return {
      source: m3u8Match[1],
      type: 'hls'
    };
  } catch (error) {
    console.error('Error:', error);
    return null;
  }
}

