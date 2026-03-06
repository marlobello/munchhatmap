/**
 * main.js — entry point for MunchHat Map frontend.
 * Initialises a Leaflet map, fetches pins from the API, and renders them.
 */

import { renderPins } from './map.js';

const API_BASE = window.API_BASE ?? '/api';

async function fetchPins() {
  const response = await fetch(`${API_BASE}/getPins`);
  if (!response.ok) throw new Error(`API returned ${response.status}`);
  return response.json();
}

const map = L.map('map').setView([20, 0], 2);

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

const countEl = document.getElementById('pin-count');

fetchPins()
  .then((pins) => {
    renderPins(map, pins);
    countEl.textContent = `${pins.length} pin${pins.length !== 1 ? 's' : ''}`;
  })
  .catch((err) => {
    console.error('Failed to load pins:', err);
    countEl.textContent = 'Failed to load pins';
  });
