export interface NormalizedGeoapifyBusiness {
  externalSource: string;
  externalId: string | null;
  name: string;
  slug: string;
  address: string | null;
  city: string | null;
  province: string | null;
  country: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  category: string | null;
  categories: string[] | null;
  openingHours: any | null;
  facilities: Record<string, any> | null;
  catering: Record<string, any> | null;
  externalMetadata: Record<string, any> | null;
  externalRating: number | null;
  externalReviewsCount: number | null;
  externalSyncedAt: Date;
}
