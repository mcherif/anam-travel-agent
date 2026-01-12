import data from './landmarks_db.json';

export type Landmark = {
  id: string;
  name: string;
  coordinates: [number, number];
  type: string;
  description: string;
  foundedYear?: string;
  highlights: string[];
  imageUrl: string;
  imageUrls?: string[];
  zoom: number;
};

type CityData = {
  city: {
    name: string;
    coordinates: [number, number];
    zoom: number;
    description: string;
  };
  landmarks: Landmark[];
};

type Database = {
  tunis: CityData;
  istanbul: CityData;
};

const db = data as Database;

export type CityId = keyof Database;

export const DEFAULT_CITY: CityId = 'tunis';

const isCityId = (value: string): value is CityId => value in db;

export const CITY_IDS = Object.keys(db) as CityId[];

export const getCityData = (cityId?: string): CityData => {
  if (cityId && isCityId(cityId)) {
    return db[cityId];
  }

  return db[DEFAULT_CITY];
};

export const getCityCenter = (cityId?: string) => {
  const city = getCityData(cityId).city;
  return {
    coordinates: city.coordinates,
    zoom: city.zoom
  };
};

export const buildLandmarksMap = (landmarks: Landmark[]) =>
  landmarks.reduce<Record<string, Landmark>>((acc, landmark) => {
    acc[landmark.id] = landmark;
    return acc;
  }, {});

export const getLandmarksByCity = (cityId?: string) =>
  buildLandmarksMap(getCityData(cityId).landmarks);

export const TUNIS_CENTER = getCityCenter('tunis');

export const LANDMARKS = getLandmarksByCity('tunis');
