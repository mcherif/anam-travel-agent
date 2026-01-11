import { describe, it, expect } from 'vitest';
import { CITY_IDS, getCityCenter, getLandmarksByCity } from '../landmarks';

describe('landmarks data', () => {
  it('exports Tunis center coordinates', () => {
    const tunisCenter = getCityCenter('tunis');
    expect(tunisCenter.coordinates).toHaveLength(2);
    expect(tunisCenter.zoom).toBeGreaterThan(0);
  });

  it('contains the MVP landmarks', () => {
    const ids = Object.keys(getLandmarksByCity('tunis'));
    expect(ids).toEqual(expect.arrayContaining(['medina', 'carthage', 'bardo', 'sidi-bou-said']));
    expect(ids.length).toBe(4);
  });

  it('includes Istanbul landmarks', () => {
    const ids = Object.keys(getLandmarksByCity('istanbul'));
    expect(ids).toEqual(expect.arrayContaining(['hagia-sophia', 'blue-mosque', 'topkapi-palace', 'galata-tower']));
    expect(ids.length).toBe(4);
  });

  it('exposes available city IDs', () => {
    expect(CITY_IDS).toEqual(expect.arrayContaining(['tunis', 'istanbul']));
  });
});
