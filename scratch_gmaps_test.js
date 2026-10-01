async function testGoogleMapsScrape(name, city) {
  try {
    const q = encodeURIComponent(`${name} ${city}`);
    const res = await fetch(`https://www.google.com/maps/search/${q}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    });
    const html = await res.text();
    const matches = html.match(/https:\/\/[a-z0-9-]+\.googleusercontent\.com\/p\/[a-zA-Z0-9_-]+/gi);
    if (matches && matches.length > 0) {
      return `${matches[0]}=w800-h500-k-no`;
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
    'Losmen Leuwi Panjang',
    'Bali World Hotel',
    'Lotus Hotel'
  ];
  for (const name of places) {
    const photoUrl = await testGoogleMapsScrape(name, 'Bandung');
    console.log(name, '->', photoUrl);
  }
}
run();
