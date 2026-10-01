async function searchRealPhoto(name, city) {
  try {
    const q = encodeURIComponent(`${name} ${city}`);
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${q}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      }
    });
    if (res.ok) {
      const html = await res.text();
      // Extract image thumbnails or result links
      const match = html.match(/https?:\/\/[^"'\s>]+\.(?:jpg|jpeg|png|webp)/gi);
      if (match) {
        return match.find(url => !url.includes('duckduckgo.com') && !url.includes('yandex') && !url.includes('ico')) || null;
      }
    }
  } catch(e) {
    console.error(e);
  }
  return null;
}

async function run() {
  const places = [
    'Dbest Express Hotel',
    'The Trans Luxury Hotel',
    'Bali World Hotel',
    'Lotus Hotel'
  ];
  for (const p of places) {
    const photo = await searchRealPhoto(p, 'Bandung');
    console.log(p, '->', photo);
  }
}
run();
