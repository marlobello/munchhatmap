/**
 * map.js — marker rendering and popup logic for MunchHat Map (Leaflet).
 */

const hatIcon = L.icon({
  iconUrl: '/munchhat.png',
  iconSize: [40, 30],     // render at 40×30 (preserves aspect ratio of 120×89)
  iconAnchor: [20, 30],   // bottom-center of the hat sits on the map point
  popupAnchor: [0, -32],  // popup appears above the icon
});

/** Escapes a string for safe use inside an HTML attribute value. */
function escapeAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Escapes a string for safe use as HTML text content. */
function escapeHtml(str) {
  return String(str).replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Validates that a string is a safe Discord snowflake (numeric only). */
function isSafeSnowflake(str) {
  return /^\d+$/.test(String(str));
}
/**
 * @param {string} iso
 * @returns {string}
 */
function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

/**
 * @param {string} guildId
 * @param {string} channelId
 * @param {string} messageId
 * @returns {string}
 */
function discordMessageLink(guildId, channelId, messageId) {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

/**
 * @param {object} pin
 * @returns {string}
 */
function buildPopupContent(pin) {
  const date = formatDate(pin.createdAt);
  // Only build the Discord link if all IDs are safe snowflakes
  const safeLink = isSafeSnowflake(pin.guildId) && isSafeSnowflake(pin.channelId) && isSafeSnowflake(pin.messageId)
    ? discordMessageLink(pin.guildId, pin.channelId, pin.messageId)
    : null;
  const caption = pin.caption
    ? `<p class="caption">${escapeHtml(pin.caption)}</p>`
    : '';
  const author = pin.username ? `@${escapeHtml(pin.username)}` : escapeHtml(`<${pin.userId}>`);
  return `
    <div class="popup-content">
      <img src="${escapeAttr(pin.imageUrl)}" alt="MunchHat photo" loading="lazy" />
      ${caption}
      <p class="meta">📅 ${date}</p>
      <p class="meta">👤 ${author}</p>
      ${safeLink ? `<a href="${escapeAttr(safeLink)}" target="_blank" rel="noopener noreferrer">View original message →</a>` : ''}
    </div>
  `;
}

/**
 * Renders all pins as Leaflet markers with popups.
 * @param {L.Map} map
 * @param {Array} pins
 */
export function renderPins(map, pins) {
  const cluster = L.markerClusterGroup({ chunkedLoading: true });
  for (const pin of pins) {
    const marker = L.marker([pin.lat, pin.lng], { icon: hatIcon })
      .bindPopup(buildPopupContent(pin), { maxWidth: 280 });
    cluster.addLayer(marker);
  }
  map.addLayer(cluster);
}
