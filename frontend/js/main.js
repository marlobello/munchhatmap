/**
 * main.js — entry point for MunchHat Map frontend.
 * Initialises a Leaflet map, fetches pins from the API, and renders them.
 * Checks Discord OAuth2 session before rendering — shows login gate if unauthenticated.
 */

import { renderPins } from './map.js';
import { initStats } from './stats.js';

const API_BASE = window.API_BASE ?? '/api';

const authGate = document.getElementById('auth-gate');
const userInfo = document.getElementById('user-info');
const userAvatar = document.getElementById('user-avatar');
const userName = document.getElementById('user-name');
const countEl = document.getElementById('pin-count');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');

// Wire auth URLs to the Function App base (not the SWA domain, which has no /api backend)
loginBtn.href = `${API_BASE}/auth/login`;
logoutBtn.href = `${API_BASE}/auth/logout`;

/** Checks session status. Returns user object if authed, null otherwise. */
async function checkAuth() {
  try {
    const res = await fetch(`${API_BASE}/auth/me`, { credentials: 'include' });
    if (res.status === 401) return null;
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

/** Shows the auth gate overlay. */
function showAuthGate() {
  authGate.classList.remove('hidden');
  countEl.textContent = '';
}

/** Shows the user pill and hides the auth gate. */
function showUser(user) {
  authGate.classList.add('hidden');
  userInfo.classList.add('visible');
  userName.textContent = user.username;
  if (user.avatar) {
    userAvatar.src = `https://cdn.discordapp.com/avatars/${user.userId}/${user.avatar}.png?size=48`;
    userAvatar.alt = user.username;
  } else {
    userAvatar.src = '/munchhat.png';
    userAvatar.alt = '';
  }
}

async function fetchPins() {
  const response = await fetch(`${API_BASE}/getPins`, { credentials: 'include' });
  if (!response.ok) throw new Error(`API returned ${response.status}`);
  return response.json();
}

const map = L.map('map').setView([20, 0], 2);

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

// Show auth gate immediately while we check session state
authGate.classList.remove('hidden');

checkAuth().then((user) => {
  if (!user) {
    showAuthGate();
    return;
  }
  showUser(user);

  fetchPins()
    .then((pins) => {
      renderPins(map, pins);
      countEl.textContent = `${pins.length} pin${pins.length !== 1 ? 's' : ''}`;
    })
    .catch((err) => {
      console.error('Failed to load pins:', err);
      countEl.textContent = 'Failed to load pins';
    });

  initStats();
});
