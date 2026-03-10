/**
 * main.js — entry point for MunchHat Map frontend.
 * Initialises a Leaflet map, fetches pins from the API, and renders them.
 * Checks Discord OAuth2 session before rendering — shows login gate if unauthenticated.
 *
 * Auth strategy: JWT stored in localStorage, sent as Authorization: Bearer header.
 * This avoids third-party cookie blocking (API is on azurewebsites.net, frontend on custom domain).
 */

import { renderPins } from './map.js';
import { initStats } from './stats.js';

const API_BASE = window.API_BASE ?? '/api';
const TOKEN_KEY = 'munchhat_token';

const authGate = document.getElementById('auth-gate');
const userInfo = document.getElementById('user-info');
const userAvatar = document.getElementById('user-avatar');
const userName = document.getElementById('user-name');
const countEl = document.getElementById('pin-count');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');

loginBtn.href = `${API_BASE}/auth/login`;

// Handle logout — clear token, redirect handled by server
logoutBtn.addEventListener('click', (e) => {
  e.preventDefault();
  localStorage.removeItem(TOKEN_KEY);
  window.location.href = `${API_BASE}/auth/logout`;
});

// Handle OAuth callback: exchange one-time code for JWT, then clear fragment
const hashMatch = window.location.hash.match(/[#&]code=([^&]*)/);
if (hashMatch) {
  history.replaceState(null, '', window.location.pathname + window.location.search);
  try {
    const res = await fetch(`${API_BASE}/auth/exchange?code=${encodeURIComponent(hashMatch[1])}`);
    if (res.ok) {
      const data = await res.json();
      if (data.token) localStorage.setItem(TOKEN_KEY, data.token);
    }
  } catch {
    // exchange failed — user will see auth gate and can log in again
  }
}

// Clear token on logout redirect
if (new URLSearchParams(window.location.search).get('logout') === '1') {
  localStorage.removeItem(TOKEN_KEY);
  history.replaceState(null, '', window.location.pathname);
}

/** Makes an authenticated API request with the stored token. */
async function authedFetch(url, options = {}) {
  const token = localStorage.getItem(TOKEN_KEY);
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

/** Checks session status. Returns user object if authed, null otherwise. */
async function checkAuth() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return null;
  try {
    const res = await authedFetch(`${API_BASE}/auth/me`);
    if (res.status === 401) {
      localStorage.removeItem(TOKEN_KEY); // expired token
      return null;
    }
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

function showAuthGate() {
  authGate.classList.remove('hidden');
  countEl.textContent = '';
}

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

const map = L.map('map', { zoomControl: false }).setView([20, 0], 2);
L.control.zoom({ position: 'bottomright' }).addTo(map);

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

// Show auth gate while session is checked
authGate.classList.remove('hidden');

checkAuth().then((user) => {
  if (!user) {
    showAuthGate();
    return;
  }
  showUser(user);

  authedFetch(`${API_BASE}/getPins`)
    .then((r) => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
    .then((pins) => {
      renderPins(map, pins, user, authedFetch, API_BASE);
      countEl.textContent = `${pins.length} pin${pins.length !== 1 ? 's' : ''}`;
    })
    .catch((err) => {
      console.error('Failed to load pins:', err);
      countEl.textContent = 'Failed to load pins';
    });

  initStats(authedFetch, API_BASE);
});
