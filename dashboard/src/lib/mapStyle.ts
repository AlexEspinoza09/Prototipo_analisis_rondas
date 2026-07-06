import type { StyleSpecification } from 'maplibre-gl';

// Free OSM raster tiles, no token required.
export const OSM_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

export const DEFAULT_VIEW = { longitude: -78.488, latitude: -0.176, zoom: 15 };
