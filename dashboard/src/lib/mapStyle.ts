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

export const DEFAULT_VIEW = { longitude: -78.4833, latitude: -0.184, zoom: 15 };

// Free vector tiles (no token, no limits) — needed for 3D building extrusion,
// which raster OSM tiles cannot provide. https://openfreemap.org
export const VECTOR_3D_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
