import { Injectable, Logger, UnauthorizedException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NormalizedGeoapifyBusiness } from './interfaces/normalized-geoapify-business.interface.js';

@Injectable()
export class ProviderService {
  private readonly logger = new Logger(ProviderService.name);

  constructor(private readonly configService: ConfigService) {}

  async searchBusinesses(keyword: string, location: string, limit: number = 100): Promise<NormalizedGeoapifyBusiness[]> {
    const apiKey = this.configService.get<string>('GEOAPIFY_API_KEY');

    if (!apiKey) {
      this.logger.error('GEOAPIFY_API_KEY belum dikonfigurasi di environment!');
      throw new UnauthorizedException('GEOAPIFY_API_KEY belum dikonfigurasi di server');
    }

    const featuresMap = new Map<string, any>();
    const fetchLimit = Math.max(limit, 100);
    const detailsParam = 'details=details,details.catering,details.contact,details.facilities,details.payment';

    try {
      // 1. Geocode location untuk mendapatkan place_id area
      const geocodeLocUrl = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(location)}&apiKey=${apiKey}`;
      const locRes = await fetch(geocodeLocUrl);
      if (locRes.ok) {
        const locData = await locRes.json();
        const locPlaceId = locData?.features?.[0]?.properties?.place_id;

        if (locPlaceId) {
          // Query Places API v2 dengan details parameter lengkap
          const placesUrl = `https://api.geoapify.com/v2/places?categories=commercial,catering,service,accommodation,rental,leisure,office&filter=place:${locPlaceId}&text=${encodeURIComponent(keyword)}&limit=${fetchLimit}&${detailsParam}&apiKey=${apiKey}`;
          const placesRes = await fetch(placesUrl);
          if (placesRes.ok) {
            const placesData = await placesRes.json();
            const placesFeatures = placesData?.features || [];
            for (const f of placesFeatures) {
              const id = f.properties?.place_id || f.properties?.name;
              if (id && !featuresMap.has(id)) {
                featuresMap.set(id, f);
              }
            }
          }
        }
      }

      // 2. Query Geocode Search API dengan limit 100
      const searchUrl = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(`${keyword} ${location}`)}&limit=${fetchLimit}&apiKey=${apiKey}`;
      const searchRes = await fetch(searchUrl);
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        const searchFeatures = searchData?.features || [];
        for (const f of searchFeatures) {
          const id = f.properties?.place_id || f.properties?.name;
          if (id && !featuresMap.has(id)) {
            featuresMap.set(id, f);
          }
        }
      }

      // 3. Multi-category expansion jika jumlah kurang dari limit
      if (featuresMap.size < fetchLimit) {
        const categoryKeywords = ['hotel', 'restaurant', 'cafe', 'rental', 'shop', 'service', 'market'];
        for (const catKw of categoryKeywords) {
          if (featuresMap.size >= fetchLimit) break;
          const extraUrl = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(`${catKw} ${location}`)}&limit=${fetchLimit}&apiKey=${apiKey}`;
          const extraRes = await fetch(extraUrl);
          if (extraRes.ok) {
            const extraData = await extraRes.json();
            const extraFeatures = extraData?.features || [];
            for (const f of extraFeatures) {
              const id = f.properties?.place_id || f.properties?.name;
              if (id && !featuresMap.has(id)) {
                featuresMap.set(id, f);
              }
            }
          }
        }
      }

      const allFeatures = Array.from(featuresMap.values()).slice(0, fetchLimit);
      this.logger.log(`Geoapify Sync: Berhasil menemukan ${allFeatures.length} bisnis untuk keyword "${keyword}" di "${location}"`);

      return allFeatures.map((feature: any) => this.normalizeBusiness(feature));
    } catch (error) {
      if (error instanceof UnauthorizedException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error('Error saat menghubungi Geoapify API:', error);
      throw new InternalServerErrorException('Gagal terhubung ke Provider Eksternal Geoapify');
    }
  }

  normalizeBusiness(feature: any): NormalizedGeoapifyBusiness {
    const props = feature?.properties || {};
    const coords = feature?.geometry?.coordinates || [];
    const raw = props.datasource?.raw || {};

    // 1. Identitas & Nama
    const name = props.name || props.address_line1 || raw.name || 'Bisnis Tanpa Nama';
    const slug = this.slugify(name);

    // 2. Kategori Taksonomi
    const categoriesArray: string[] = Array.isArray(props.categories) ? props.categories : [];
    const mainCategory = categoriesArray.length > 0 ? categoriesArray[categoriesArray.length - 1] : (raw.amenity || raw.shop || null);

    // 3. Fallback Kontak: Top-Level -> Nested Contact -> Raw OSM Tags
    const phone = props.contact?.phone || props.phone || raw.phone || raw['contact:phone'] || null;
    const email = props.contact?.email || props.email || raw.email || raw['contact:email'] || null;
    const website = props.contact?.website || props.website || props.url || raw.website || raw['contact:website'] || null;

    // 4. Fallback Jam Operasional
    const openingHours = props.opening_hours || raw.opening_hours || null;

    // 5. Fasilitas & Katering
    const facilities = props.facilities || {
      wheelchair: props.wheelchair ?? (raw.wheelchair === 'yes' ? true : raw.wheelchair === 'no' ? false : null),
      internet_access: props.internet_access || raw.internet_access || null,
      payment_options: props.payment || raw.payment || null,
    };

    const catering = props.catering || {
      takeaway: props.takeaway ?? (raw.takeaway === 'yes' ? true : raw.takeaway === 'no' ? false : null),
      delivery: props.delivery ?? (raw.delivery === 'yes' ? true : raw.delivery === 'no' ? false : null),
      outdoor_seating: props.outdoor_seating || raw.outdoor_seating || null,
      cuisine: raw.cuisine || null,
    };

    // 6. Alamat & Wilayah
    const address = props.address_line1 || props.formatted || raw.address || null;
    const city = props.city || props.county || props.district || raw.city || null;
    const province = props.state || props.region || raw.state || null;
    const country = props.country || props.country_code?.toUpperCase() || 'ID';
    const postalCode = props.postcode || raw.postcode || null;
    const latitude = props.lat || (coords.length > 1 ? coords[1] : null);
    const longitude = props.lon || (coords.length > 0 ? coords[0] : null);

    return {
      externalSource: 'GEOAPIFY',
      externalId: props.place_id || props.id || null,
      name,
      slug,
      address,
      city,
      province,
      country,
      postalCode,
      latitude,
      longitude,
      phone,
      email,
      website,
      category: mainCategory,
      categories: categoriesArray,
      openingHours: typeof openingHours === 'string' ? { raw: openingHours } : openingHours,
      facilities,
      catering,
      externalMetadata: props, // RETENSI TOTAL: Menyimpan seluruh atribut GeoJSON mentah + raw OSM tags
      externalRating: props.rank?.popularity ? parseFloat((props.rank.popularity * 5).toFixed(2)) : 4.5,
      externalReviewsCount: raw.votes ? parseInt(raw.votes, 10) : 12,
      externalSyncedAt: new Date(),
    };
  }

  private slugify(text: string): string {
    return text
      .toString()
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^\w\-]+/g, '')
      .replace(/\-\-+/g, '-');
  }
}
