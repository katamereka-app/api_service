async function getRealImage(name, city) {
  try {
    const query = encodeURIComponent(`${name} ${city}`);
    const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${query}&gsrlimit=5&prop=imageinfo&iiprop=url&format=json&origin=*`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const pages = data?.query?.pages || {};
      for (const pId of Object.keys(pages)) {
        const imgUrl = pages[pId]?.imageinfo?.[0]?.url;
        if (imgUrl && !imgUrl.endsWith('.svg') && !imgUrl.endsWith('.png')) {
          return imgUrl;
        }
      }
    }
  } catch (e) {
    console.error(e);
  }
  return null;
}

async function run() {
  const places = [
    'Losmen Leuwi Panjang',
    'Dbest Express Hotel',
    'The Trans Luxury Hotel',
    'Bali World Hotel'
  ];
  for (const name of places) {
    const img = await getRealImage(name, 'Bandung');
    console.log(name, '->', img);
  }
}
run();
