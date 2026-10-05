import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BusinessPlaceResult } from './interfaces/business-place-result.interface.js';
import { StorageService } from '../businesses/storage/storage.service.js';
import { OperatingHoursService } from '../businesses/operating-hours.service.js';
import { Business, BusinessStatus } from '../businesses/entities/business.entity.js';
import { BusinessOperatingHours } from '../businesses/entities/business-operating-hours.entity.js';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class BusinessPlacesService {
  private readonly logger = new Logger(BusinessPlacesService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly storageService: StorageService,
    private readonly operatingHoursService: OperatingHoursService,
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
    @InjectRepository(BusinessOperatingHours)
    private readonly operatingHoursRepository: Repository<BusinessOperatingHours>,
  ) { }

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
            let imageSource: 'wikimedia' | 'google' | 'google_internal' | 'foursquare' | 'geoapify_map' | 'none' = 'none';

            // 0. SINKRONISASI SMART S3 CACHE: Cek apakah gambar untuk tempat ini sudah tersinkronisasi di S3
            const cleanId = id.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40);
            const filename = `place_${cleanId}.jpg`;
            const existingS3Url = await this.storageService.getExistingFileUrl(filename, 'places');

            if (existingS3Url) {
              this.logger.log(`[Cache Hit S3] Gambar untuk "${name}" (ID: ${id}) sudah tersinkronisasi di S3. Skip API Eksternal.`);
              imageUrl = existingS3Url;
              imageSource = 'google_internal';
            } else {
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

              // 2. FALLBACK GAMBAR (Foursquare Places API - Gratis & Real Photo)
              const fsqApiKey = this.configService.get<string>('FOURSQUARE_API_KEY');
              if (!imageUrl && fsqApiKey) {
                const fsqPhotoUrl = await this.fetchFoursquarePhotoUrl(name, lat, lon, fsqApiKey);
                if (fsqPhotoUrl) {
                  imageUrl = fsqPhotoUrl;
                  imageSource = 'foursquare';
                }
              }

              // 3. FALLBACK GAMBAR (Google Places API / Google Cloud) -> AUTO SAVE TO INTERNAL STORAGE
              if (!imageUrl && googleApiKey) {
                this.logger.log(`[Sync Gambar Google] Seeking Google Places Photo for "${name}" at (${lat}, ${lon})`);
                const googlePhotoUrl = await this.fetchGooglePhotoUrl(name, lat, lon, googleApiKey);
                if (googlePhotoUrl) {
                  // Auto Upload / Save buffer to Internal Storage (S3 / Local Storage)
                  imageUrl = await this.savePhotoToInternalStorage(googlePhotoUrl, id);
                  imageSource = 'google_internal';
                }
              }

              // 4. FALLBACK GAMBAR ASLI GEOAPIFY (Geoapify Static Location Map Photo)
              if (!imageUrl && geoapifyApiKey && lat && lon) {
                imageUrl = `https://maps.geoapify.com/v1/staticmap?style=osm-bright-smooth&width=600&height=400&center=lonlat:${lon},${lat}&zoom=16&marker=lonlat:${lon},${lat};color:%23ff2b2b;size:medium&apiKey=${geoapifyApiKey}`;
                imageSource = 'geoapify_map';
              }
            }

            // Extract raw opening_hours string from Geoapify feature properties
            const rawOpeningHours = props.opening_hours || props.datasource?.raw?.opening_hours || props.details?.opening_hours;
            let operatingHours;

            if (rawOpeningHours) {
              operatingHours = this.operatingHoursService.parseAndCalculate(rawOpeningHours, 'geoapify_osm');
            } else if (googleApiKey) {
              // Fallback Otomatis: Fetch Opening Hours dari Google Places API (Place Details)
              const googleDetails = await this.fetchGooglePlaceDetails(name, lat, lon, googleApiKey);
              if (googleDetails.openingHours) {
                operatingHours = this.operatingHoursService.parseGoogleOpeningHoursObject(googleDetails.openingHours);
              } else {
                operatingHours = this.operatingHoursService.parseAndCalculate(null, 'unknown');
              }
            } else {
              operatingHours = this.operatingHoursService.parseAndCalculate(null, 'unknown');
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
              operatingHours,
            });
          }

          await this.autoPersistResultsToDb(results);
          return results;
        }
      }
    } catch (err) {
      this.logger.error('Geoapify Places API error, mengalihkan ke Total Failover Google Places:', err);
    }

    // 3. TOTAL FAILOVER / FALLBACK PENUH (Google Places API)
    this.logger.log(`[Total Failover] Switched completely to Google Places API`);
    const googleResults = await this.fetchTotalFailoverGooglePlaces(keyword, location, limit, googleApiKey);
    if (googleResults && googleResults.length > 0) {
      return googleResults;
    }

    // 4. FALLBACK TERAKHIR (Database Lokal PostgreSQL saat Offline / Connection Error)
    return await this.fallbackSearchLocalDatabase(keyword, location, limit);
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

  // Resolusi Gambar via Foursquare Places API v3 (Search Venue -> Venue Photos)
  private async fetchFoursquarePhotoUrl(name: string, lat: number, lon: number, apiKey: string): Promise<string | null> {
    try {
      const headers = {
        Authorization: apiKey,
        Accept: 'application/json',
      };
      const searchUrl = `https://api.foursquare.com/v3/places/search?query=${encodeURIComponent(name)}&ll=${lat},${lon}&limit=1`;
      const res = await fetch(searchUrl, { headers });
      if (res.ok) {
        const data = await res.json();
        const fsqId = data?.results?.[0]?.fsq_id;
        if (fsqId) {
          const photosUrl = `https://api.foursquare.com/v3/places/${fsqId}/photos?limit=1`;
          const photoRes = await fetch(photosUrl, { headers });
          if (photoRes.ok) {
            const photos = await photoRes.json();
            if (photos && photos.length > 0) {
              return `${photos[0].prefix}original${photos[0].suffix}`;
            }
          }
        }
      }
    } catch (err) {
      this.logger.error(`Gagal fetch Foursquare photo for "${name}":`, err);
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

  // Fetch Google Place Details for photo and opening hours
  private async fetchGooglePlaceDetails(name: string, lat: number, lon: number, apiKey: string): Promise<{ photoUrl: string | null; openingHours: any | null }> {
    try {
      const searchUrl = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(name)}&inputtype=textquery&locationbias=point:${lat},${lon}&fields=photos,place_id&key=${apiKey}`;
      const res = await fetch(searchUrl);
      if (res.ok) {
        const data = await res.json();
        const candidate = data?.candidates?.[0];
        if (candidate?.place_id) {
          const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${candidate.place_id}&fields=photos,opening_hours&key=${apiKey}`;
          const dRes = await fetch(detailsUrl);
          if (dRes.ok) {
            const dData = await dRes.json();
            const result = dData?.result;
            let photoUrl: string | null = null;
            if (result?.photos && result.photos.length > 0) {
              const photoRef = result.photos[0].photo_reference;
              photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=500&photo_reference=${photoRef}&key=${apiKey}`;
            }
            return {
              photoUrl,
              openingHours: result?.opening_hours || null,
            };
          }
        }
      }
    } catch (err) {
      this.logger.error(`Gagal fetch Google Place Details for "${name}":`, err);
    }
    return { photoUrl: null, openingHours: null };
  }

  // Auto-download external photo and save to internal S3 / MinIO storage
  private async savePhotoToInternalStorage(externalPhotoUrl: string, placeId: string): Promise<string> {
    try {
      const cleanId = placeId.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40);
      const filename = `place_${cleanId}.jpg`;
      const res = await fetch(externalPhotoUrl);
      if (res.ok) {
        const arrayBuffer = await res.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        return await this.storageService.uploadBuffer(buffer, filename, 'places');
      }
    } catch (err) {
      this.logger.error(`Gagal menyimpan foto internal S3 untuk ID "${placeId}":`, err);
    }
    return externalPhotoUrl;
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

        const mappedResults: BusinessPlaceResult[] = results.slice(0, limit).map((p: any) => {
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

        await this.autoPersistResultsToDb(mappedResults);
        return mappedResults;
      }
    } catch (err) {
      this.logger.error('Google Places Total Failover error:', err);
    }

    return [];
  }

  private async autoPersistResultsToDb(results: BusinessPlaceResult[]): Promise<void> {
    for (const item of results) {
      try {
        const cleanId = item.id.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40);
        let business = await this.businessRepository.findOne({ where: { externalId: item.id } });
        
        if (!business) {
          const baseSlug = item.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'place';
          const slug = `${baseSlug}-${cleanId}`;

          business = this.businessRepository.create({
            externalId: item.id,
            externalSource: item.dataSource || 'geoapify',
            name: item.name,
            slug,
            address: item.address,
            latitude: item.latitude,
            longitude: item.longitude,
            logoUrl: item.imageUrl || undefined,
            status: BusinessStatus.ACTIVE,
          });
          business = await this.businessRepository.save(business);
        }

        if (item.operatingHours && business) {
          let opRecord = await this.operatingHoursRepository.findOne({ where: { businessId: business.id } });
          if (!opRecord) {
            opRecord = this.operatingHoursRepository.create({
              businessId: business.id,
            });
          }

          opRecord.isOpen = item.operatingHours.isOpen;
          opRecord.statusText = item.operatingHours.statusText;
          opRecord.nextChangeText = item.operatingHours.nextChangeText;
          opRecord.rawSchedule = item.operatingHours.rawSchedule;
          opRecord.source = item.operatingHours.source || 'unknown';
          opRecord.weeklySchedule = item.operatingHours.weeklySchedule;

          await this.operatingHoursRepository.save(opRecord);
        }
      } catch (err) {
        this.logger.error(`Gagal auto-persist bisnis "${item.name}" ke DB:`, err);
      }
    }
  }

  private async fallbackSearchLocalDatabase(keyword: string, location: string, limit: number): Promise<BusinessPlaceResult[]> {
    this.logger.log(`[Offline / Database Fallback] Searching local database for keyword "${keyword}" in "${location}"`);
    try {
      const qb = this.businessRepository.createQueryBuilder('b')
        .leftJoinAndSelect('b.operatingHoursDetail', 'oh')
        .where('(b.name ILIKE :kw OR b.address ILIKE :kw)', { kw: `%${keyword}%` });

      if (location) {
        qb.andWhere('(b.address ILIKE :loc OR b.city ILIKE :loc)', { loc: `%${location}%` });
      }

      const businesses = await qb.take(limit).getMany();

      return businesses.map((b) => {
        let opHours;
        if (b.operatingHoursDetail) {
          opHours = {
            isOpen: b.operatingHoursDetail.isOpen,
            statusText: b.operatingHoursDetail.statusText || 'Jam Operasional Tidak Tersedia',
            rawSchedule: b.operatingHoursDetail.rawSchedule,
            source: b.operatingHoursDetail.source || 'unknown',
            nextChangeText: b.operatingHoursDetail.nextChangeText,
            weeklySchedule: b.operatingHoursDetail.weeklySchedule || [],
          };
        } else {
          opHours = this.operatingHoursService.parseAndCalculate(null, 'unknown');
        }

        return {
          id: b.externalId || b.id,
          name: b.name,
          address: b.address || '',
          latitude: b.latitude || 0,
          longitude: b.longitude || 0,
          categories: [],
          imageUrl: b.logoUrl || null,
          imageSource: b.logoUrl ? 'google_internal' : 'none',
          dataSource: 'google_places' as any,
          operatingHours: opHours,
        };
      });
    } catch (err) {
      this.logger.error('Gagal fallback pencarian ke Database Lokal:', err);
      return [];
    }
  }
}
