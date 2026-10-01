import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BusinessPlaceResult } from './interfaces/business-place-result.interface.js';

@Injectable()
export class BusinessPlacesService {
  private readonly logger = new Logger(BusinessPlacesService.name);

  constructor(private readonly configService: ConfigService) {}

  async searchBusinessPlaces(keyword: string, location: string, limit: number = 20): Promise<BusinessPlaceResult[]> {
    const geoapifyApiKey = this.configService.get<string>('GEOAPIFY_API_KEY');
    const googleApiKey = this.configService.get<string>('GOOGLE_MAPS_API_KEY');

    // 1. PRIORITAS UTAMA (Geoapify Places API)
    try {
      if (geoapifyApiKey) {
        this.logger.log(`[Prioritas 1] Fetching Geoapify Places with details=wiki_and_media for "${keyword}" in "${location}"`);

        let features: any[] = [];

        // Geocode location untuk mendapatkan place_id area filter
        const geocodeLocUrl = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(location)}&apiKey=${geoapifyApiKey}`;
        const locRes = await fetch(geocodeLocUrl);
        if (locRes.ok) {
          const locData = await locRes.json();
          const locPlaceId = locData?.features?.[0]?.properties?.place_id;

          if (locPlaceId) {
            const placesUrl = `https://api.geoapify.com/v2/places?categories=commercial,catering,service,accommodation,rental,leisure,office&filter=place:${locPlaceId}&text=${encodeURIComponent(keyword)}&details=details,details.wiki_and_media&limit=${limit}&apiKey=${geoapifyApiKey}`;
            const placesRes = await fetch(placesUrl);
            if (placesRes.ok) {
              const placesData = await placesRes.json();
              features = placesData?.features || [];
            }
          }
        }

        // Fallback geocode search jika filter place_id belum mengembalikan data
        if (features.length === 0) {
          const searchUrl = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(`${keyword} ${location}`)}&limit=${limit}&apiKey=${geoapifyApiKey}`;
          const searchRes = await fetch(searchUrl);
          if (searchRes.ok) {
            const searchData = await searchRes.json();
            features = searchData?.features || [];
          }
        }

        if (features.length > 0) {
          const results: BusinessPlaceResult[] = [];

          for (const f of features) {
            const props = f.properties || {};
            const id = props.place_id || `geo_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
            const name = props.name || props.formatted || keyword;
            const address = props.formatted || props.address_line2 || props.address_line1 || '';
            const lat = props.lat || f.geometry?.coordinates?.[1] || 0;
            const lon = props.lon || f.geometry?.coordinates?.[0] || 0;
            const categories = props.categories || [];

            let imageUrl: string | null = null;
            let imageSource: 'wikimedia' | 'google' | 'none' = 'none';

            // 1.a & 1.b Cek field properties.wiki_and_media.wikimedia_commons atau wikidata
            const wikiMedia = props.wiki_and_media || props.details?.wiki_and_media;
            if (wikiMedia) {
              if (wikiMedia.wikimedia_commons) {
                imageUrl = await this.resolveWikimediaCommonsUrl(wikiMedia.wikimedia_commons);
                if (imageUrl) imageSource = 'wikimedia';
              } else if (wikiMedia.wikidata) {
                imageUrl = await this.resolveWikidataClaimsUrl(wikiMedia.wikidata);
                if (imageUrl) imageSource = 'wikimedia';
              }
            }

            // 2. FALLBACK GAMBAR (Google Places API / Google Cloud)
            if (!imageUrl && googleApiKey) {
              this.logger.log(`[Fallback Gambar Google] Seeking Google Places Photo for "${name}" at (${lat}, ${lon})`);
              const googlePhotoUrl = await this.fetchGooglePhotoUrl(name, lat, lon, googleApiKey);
              if (googlePhotoUrl) {
                imageUrl = googlePhotoUrl;
                imageSource = 'google';
              }
            }

            results.push({
              id,
              name,
              address,
              latitude: lat,
              longitude: lon,
              categories,
              imageUrl,
              imageSource,
              dataSource: 'geoapify',
            });
          }

          return results;
        }
      }
    } catch (err) {
      this.logger.error('Geoapify Places API error, mengalihkan ke Total Failover Google Places:', err);
    }

    // 3. TOTAL FAILOVER / FALLBACK PENUH (Google Places API)
    this.logger.log(`[Total Failover] Switched completely to Google Places API`);
    return await this.fetchTotalFailoverGooglePlaces(keyword, location, limit, googleApiKey);
  }

  // Resolusi Gambar via Wikimedia Commons API
  private async resolveWikimediaCommonsUrl(commonsTitle: string): Promise<string | null> {
    try {
      const cleanTitle = commonsTitle.replace('File:', '').trim();
      const apiUrl = `https://commons.wikimedia.org/w/api.php?action=query&titles=File:${encodeURIComponent(cleanTitle)}&prop=imageinfo&iiprop=url&format=json&origin=*`;
      const res = await fetch(apiUrl);
      if (res.ok) {
        const data = await res.json();
        const pages = data?.query?.pages || {};
        const pageId = Object.keys(pages)[0];
        if (pageId && pageId !== '-1') {
          return pages[pageId]?.imageinfo?.[0]?.url || null;
        }
      }
    } catch (err) {
      this.logger.error(`Gagal resolve Wikimedia Commons URL "${commonsTitle}":`, err);
    }
    return null;
  }

  // Resolusi Gambar via Wikidata Claims API (P18 = Image)
  private async resolveWikidataClaimsUrl(wikidataId: string): Promise<string | null> {
    try {
      const apiUrl = `https://www.wikidata.org/wiki/Special:EntityData/${wikidataId}.json`;
      const res = await fetch(apiUrl);
      if (res.ok) {
        const data = await res.json();
        const claims = data?.entities?.[wikidataId]?.claims;
        const p18 = claims?.P18;
        if (p18 && p18.length > 0) {
          const fileName = p18[0]?.mainsnak?.datavalue?.value;
          if (fileName) {
            return await this.resolveWikimediaCommonsUrl(fileName);
          }
        }
      }
    } catch (err) {
      this.logger.error(`Gagal resolve Wikidata Claims URL "${wikidataId}":`, err);
    }
    return null;
  }

  // 2. Fetch Photo via Google Places API (Find Place -> Photos API)
  private async fetchGooglePhotoUrl(name: string, lat: number, lon: number, apiKey: string): Promise<string | null> {
    try {
      const searchUrl = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(name)}&inputtype=textquery&locationbias=point:${lat},${lon}&fields=photos,place_id&key=${apiKey}`;
      const res = await fetch(searchUrl);
      if (res.ok) {
        const data = await res.json();
        const candidates = data?.candidates || [];
        if (candidates.length > 0 && candidates[0].photos?.length > 0) {
          const photoRef = candidates[0].photos[0].photo_reference;
          return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=500&photo_reference=${photoRef}&key=${apiKey}`;
        }
      }
    } catch (err) {
      this.logger.error(`Gagal fetch Google Places photo for "${name}":`, err);
    }
    return null;
  }

  // 3. Total Failover ke Google Places API (Nearby Search / Text Search)
  private async fetchTotalFailoverGooglePlaces(
    keyword: string,
    location: string,
    limit: number,
    apiKey?: string,
  ): Promise<BusinessPlaceResult[]> {
    if (!apiKey) {
      this.logger.warn('GOOGLE_MAPS_API_KEY belum dikonfigurasi di environment!');
      return [];
    }

    try {
      const textSearchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(`${keyword} ${location}`)}&key=${apiKey}`;
      const res = await fetch(textSearchUrl);
      if (res.ok) {
        const data = await res.json();
        const results = data?.results || [];

        return results.slice(0, limit).map((p: any) => {
          let imageUrl: string | null = null;
          let imageSource: 'wikimedia' | 'google' | 'none' = 'none';

          if (p.photos && p.photos.length > 0) {
            const photoRef = p.photos[0].photo_reference;
            imageUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=500&photo_reference=${photoRef}&key=${apiKey}`;
            imageSource = 'google';
          }

          return {
            id: p.place_id,
            name: p.name,
            address: p.formatted_address || '',
            latitude: p.geometry?.location?.lat || 0,
            longitude: p.geometry?.location?.lng || 0,
            categories: p.types || [],
            imageUrl,
            imageSource,
            dataSource: 'google_places',
          };
        });
      }
    } catch (err) {
      this.logger.error('Google Places Total Failover error:', err);
    }

    return [];
  }
}
