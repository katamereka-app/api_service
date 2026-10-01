import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Place } from './entities/place.entity.js';
import { Business } from '../businesses/entities/business.entity.js';
import { GetPlacePhotoDto } from './dto/get-place-photo.dto.js';

@Injectable()
export class PlacesService {
  private readonly logger = new Logger(PlacesService.name);
  private memoryCache = new Map<string, { value: string; expiresAt: number }>();

  constructor(
    @InjectRepository(Place)
    private readonly placeRepository: Repository<Place>,
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
    private readonly configService: ConfigService,
  ) {}

  private getFromCache(key: string): string | null {
    const item = this.memoryCache.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      this.memoryCache.delete(key);
      return null;
    }
    return item.value;
  }

  private setToCache(key: string, value: string, ttlSeconds: number): void {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.memoryCache.set(key, { value, expiresAt });
  }

  async getPlacePhoto(dto: GetPlacePhotoDto) {
    const { geoapify_place_id, name, lat, lon } = dto;
    const cacheKey = `place:photo:${geoapify_place_id}`;

    // LANGKAH 1: Cek Cache Redis / In-Memory Cache
    const cachedPhoto = this.getFromCache(cacheKey);
    if (cachedPhoto !== null) {
      this.logger.log(`[Cache Hit] place:photo:${geoapify_place_id}`);
      return {
        success: true,
        source: 'CACHE',
        geoapify_place_id,
        photo_url: cachedPhoto === 'NO_PHOTO' ? null : cachedPhoto,
      };
    }

    // LANGKAH 2: Cek ke Database PostgreSQL (Entity Place & Business)
    let place = await this.placeRepository.findOne({ where: { geoapifyPlaceId: geoapify_place_id } });
    if (place && place.photoUrl) {
      this.logger.log(`[DB Hit] Place found in PostgreSQL: ${geoapify_place_id}`);
      this.setToCache(cacheKey, place.photoUrl, 86400);
      return {
        success: true,
        source: 'DATABASE',
        geoapify_place_id,
        photo_url: place.photoUrl,
      };
    }

    const business = await this.businessRepository.findOne({
      where: { externalId: geoapify_place_id },
    });
    if (business && business.coverUrl) {
      this.logger.log(`[DB Hit] Business coverUrl found in PostgreSQL: ${geoapify_place_id}`);
      this.setToCache(cacheKey, business.coverUrl, 86400);
      return {
        success: true,
        source: 'DATABASE',
        geoapify_place_id,
        photo_url: business.coverUrl,
      };
    }

    // LANGKAH 3: Panggil Foursquare Places API v3 (Search by Query & Lat/Lon Coordinate)
    const foursquareApiKey = this.configService.get<string>('FOURSQUARE_API_KEY');

    let photoUrl: string | null = null;
    let fsqId: string | null = place?.fsqId || business?.fsqId || null;

    if (foursquareApiKey) {
      try {
        // a. GET https://api.foursquare.com/v3/places/search?query={name}&ll={lat},{lon}&limit=1
        if (!fsqId) {
          const searchUrl = `https://api.foursquare.com/v3/places/search?query=${encodeURIComponent(name)}&ll=${lat},${lon}&limit=1`;
          this.logger.log(`[Foursquare API] Searching place: "${name}" at coordinates (${lat}, ${lon})`);
          
          const searchRes = await fetch(searchUrl, {
            headers: {
              Authorization: foursquareApiKey,
              Accept: 'application/json',
            },
          });

          if (searchRes.ok) {
            const searchData = await searchRes.json();
            if (searchData?.results?.length > 0) {
              fsqId = searchData.results[0].fsq_id;
              this.logger.log(`[Foursquare API] Found fsq_id: ${fsqId} for ${name}`);
            } else {
              this.logger.warn(`[Foursquare API] Place "${name}" at (${lat}, ${lon}) not found in Foursquare DB`);
            }
          } else {
            const errText = await searchRes.text();
            this.logger.error(`[Foursquare API Error ${searchRes.status}]: ${errText}`);
          }
        }

        // b & c. GET https://api.foursquare.com/v3/places/{fsq_id}/photos?limit=1
        if (fsqId) {
          const photosUrl = `https://api.foursquare.com/v3/places/${fsqId}/photos?limit=1`;
          const photosRes = await fetch(photosUrl, {
            headers: {
              Authorization: foursquareApiKey,
              Accept: 'application/json',
            },
          });

          if (photosRes.ok) {
            const photosData = await photosRes.json();
            if (photosData && photosData.length > 0) {
              const photoObj = photosData[0];
              // d. Rakit URL foto dari Foursquare: ${prefix}500x500${suffix}
              photoUrl = `${photoObj.prefix}500x500${photoObj.suffix}`;
              this.logger.log(`[Foursquare API Success] Photo assembled: ${photoUrl}`);
            }
          }
        }
      } catch (err) {
        this.logger.error('Gagal memanggil Foursquare API:', err);
      }
    }

    // LANGKAH 4: Simpan ke PostgreSQL & Cache Redis / Handling Edge Cases
    if (photoUrl) {
      if (!place) {
        place = this.placeRepository.create({
          geoapifyPlaceId: geoapify_place_id,
          name,
          latitude: lat,
          longitude: lon,
          fsqId,
          photoUrl,
        });
      } else {
        place.fsqId = fsqId;
        place.photoUrl = photoUrl;
      }
      await this.placeRepository.save(place);

      if (business) {
        business.fsqId = fsqId;
        business.coverUrl = photoUrl;
        await this.businessRepository.save(business);
      }

      // TTL 24 jam (86400 detik)
      this.setToCache(cacheKey, photoUrl, 86400);

      return {
        success: true,
        source: 'FOURSQUARE_API',
        geoapify_place_id,
        fsq_id: fsqId,
        photo_url: photoUrl,
      };
    } else {
      // EDGE CASE HANDLING: Jika tempat/foto tidak ditemukan di Foursquare, simpan NO_PHOTO (TTL 1 Jam) agar tidak boros query API
      this.setToCache(cacheKey, 'NO_PHOTO', 3600);
      return {
        success: true,
        source: 'FOURSQUARE_API_NOT_FOUND',
        geoapify_place_id,
        fsq_id: fsqId,
        photo_url: null,
      };
    }
  }

  async getPhotoByPlaceId(geoapifyPlaceId: string) {
    const cacheKey = `place:photo:${geoapifyPlaceId}`;
    const cached = this.getFromCache(cacheKey);

    if (cached) {
      return {
        success: true,
        geoapify_place_id: geoapifyPlaceId,
        photo_url: cached === 'NO_PHOTO' ? null : cached,
      };
    }

    const place = await this.placeRepository.findOne({ where: { geoapifyPlaceId } });
    if (place) {
      this.setToCache(cacheKey, place.photoUrl || 'NO_PHOTO', 86400);
      return {
        success: true,
        geoapify_place_id: geoapifyPlaceId,
        photo_url: place.photoUrl,
      };
    }

    return {
      success: false,
      message: 'Foto tempat belum terdaftar di database',
      geoapify_place_id: geoapifyPlaceId,
      photo_url: null,
    };
  }
}
