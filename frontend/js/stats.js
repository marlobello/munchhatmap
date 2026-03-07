/**
 * stats.js — fetches and renders the stats side panel.
 */

const API_BASE = window.API_BASE ?? '/api';

function rankBadge(i) {
  if (i === 0) return '🥇';
  if (i === 1) return '🥈';
  if (i === 2) return '🥉';
  return `${i + 1}.`;
}

function renderList(items, labelKey) {
  if (!items.length) return '<p class="stats-empty">No data yet</p>';
  return items.map((item, i) => `
    <div class="stats-row">
      <span class="stats-rank">${rankBadge(i)}</span>
      <span class="stats-label">${item[labelKey].replace(/</g, '&lt;')}</span>
      <span class="stats-count">${item.count}</span>
    </div>
  `).join('');
}

function renderStats(stats) {
  return `
    <div class="stats-section">
      <h3>🏆 Leaderboard</h3>
      ${renderList(stats.users, 'username')}
    </div>
    <div class="stats-section">
      <h3>🇺🇸 US States</h3>
      ${renderList(stats.states, 'name')}
    </div>
    <div class="stats-section">
      <h3>🌍 Countries</h3>
      ${renderList(stats.countries, 'name')}
    </div>
  `;
}

export function initStats() {
  const toggleBtn = document.getElementById('stats-toggle');
  const panel = document.getElementById('stats-panel');
  const closeBtn = document.getElementById('stats-close');
  const content = document.getElementById('stats-content');

  function loadStats() {
    content.innerHTML = '<p class="stats-empty">Loading…</p>';
    fetch(`${API_BASE}/getStats`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((stats) => {
        content.innerHTML = renderStats(stats);
      })
      .catch((err) => {
        content.innerHTML = `<p class="stats-empty">Failed to load stats</p>`;
        console.error('Stats error:', err);
      });
  }

  function openPanel() {
    panel.classList.add('open');
    toggleBtn.setAttribute('aria-expanded', 'true');
    loadStats();
  }

  function closePanel() {
    panel.classList.remove('open');
    toggleBtn.setAttribute('aria-expanded', 'false');
  }

  toggleBtn.addEventListener('click', () => {
    panel.classList.contains('open') ? closePanel() : openPanel();
  });
  closeBtn.addEventListener('click', closePanel);
}
