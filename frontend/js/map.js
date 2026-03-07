/**
 * map.js — marker rendering and popup logic for MunchHat Map (Leaflet).
 */

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
  const discordLink = discordMessageLink(pin.guildId, pin.channelId, pin.messageId);
  const caption = pin.caption
    ? `<p class="caption">${pin.caption.replace(/</g, '&lt;')}</p>`
    : '';
  const author = pin.username ? `@${pin.username}` : `<${pin.userId}>`;
  return `
    <div class="popup-content">
      <img src="${pin.imageUrl}" alt="MunchHat photo" loading="lazy" />
      ${caption}
      <p class="meta">📅 ${date}</p>
      <p class="meta">👤 ${author}</p>
      <a href="${discordLink}" target="_blank" rel="noopener noreferrer">
        View original message →
      </a>
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
    const marker = L.marker([pin.lat, pin.lng])
      .bindPopup(buildPopupContent(pin), { maxWidth: 280 });
    cluster.addLayer(marker);
  }
  map.addLayer(cluster);
}
