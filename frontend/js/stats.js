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

function createEl(tag, className, textContent) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (textContent !== undefined) el.textContent = textContent;
  return el;
}

function renderList(items, labelKey) {
  if (!items.length) {
    return createEl('p', 'stats-empty', 'No data yet');
  }
  const frag = document.createDocumentFragment();
  items.forEach((item, i) => {
    const row = createEl('div', 'stats-row');
    row.appendChild(createEl('span', 'stats-rank', rankBadge(i)));
    row.appendChild(createEl('span', 'stats-label', String(item[labelKey])));
    row.appendChild(createEl('span', 'stats-count', String(item.count)));
    frag.appendChild(row);
  });
  return frag;
}

function renderStats(stats) {
  const wrapper = document.createDocumentFragment();

  const sections = [
    { title: '🏆 Leaderboard', items: stats.users, key: 'username' },
    { title: '🇺🇸 US States',  items: stats.states,    key: 'name' },
    { title: '🌍 Countries',   items: stats.countries,  key: 'name' },
  ];

  for (const { title, items, key } of sections) {
    const section = createEl('div', 'stats-section');
    section.appendChild(createEl('h3', null, title));
    section.appendChild(renderList(items, key));
    wrapper.appendChild(section);
  }
  return wrapper;
}

export function initStats(authedFetch, apiBase) {
  const base = apiBase ?? window.API_BASE ?? '/api';
  const toggleBtn = document.getElementById('stats-toggle');
  const panel = document.getElementById('stats-panel');
  const closeBtn = document.getElementById('stats-close');
  const content = document.getElementById('stats-content');
  const doFetch = authedFetch ?? ((url) => fetch(url));

  function loadStats() {
    content.replaceChildren(createEl('p', 'stats-empty', 'Loading…'));
    doFetch(`${base}/getStats`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((stats) => {
        content.replaceChildren(renderStats(stats));
      })
      .catch((err) => {
        content.replaceChildren(createEl('p', 'stats-empty', 'Failed to load stats'));
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
