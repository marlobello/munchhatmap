/**
 * main.js — entry point for MunchHat Map frontend.
 * Fetches pins from the API and exposes initMap() for the Google Maps callback.
 */

import { renderPins } from './map.js';

const API_BASE = window.API_BASE ?? '/api';

async function fetchPins() {
  const response = await fetch(`${API_BASE}/getPins`);
  if (!response.ok) throw new Error(`API returned ${response.status}`);
  return response.json();
}

// Google Maps calls this once the API script has loaded.
window.initMap = async function initMap() {
  const mapEl = document.getElementById('map');
  const countEl = document.getElementById('pin-count');

  const map = new google.maps.Map(mapEl, {
    center: { lat: 20, lng: 0 },
    zoom: 2,
    mapTypeId: 'roadmap',
  });

  try {
    const pins = await fetchPins();
    renderPins(map, pins);
    countEl.textContent = `${pins.length} pin${pins.length !== 1 ? 's' : ''}`;
  } catch (err) {
    console.error('Failed to load pins:', err);
    countEl.textContent = 'Failed to load pins';
  }
};
