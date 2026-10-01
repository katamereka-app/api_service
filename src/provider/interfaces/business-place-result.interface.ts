export interface BusinessPlaceResult {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  categories: string[];
  imageUrl: string | null;
  imageSource: 'wikimedia' | 'google' | 'none';
  dataSource: 'geoapify' | 'google_places';
}
