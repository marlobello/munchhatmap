/**
 * map.js — marker rendering and info window logic for MunchHat Map.
 */

/**
 * Formats an ISO timestamp into a readable local date/time string.
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
 * Builds a Discord deep-link URL to the original message.
 * @param {string} guildId
 * @param {string} channelId
 * @param {string} messageId
 * @returns {string}
 */
function discordMessageLink(guildId, channelId, messageId) {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

/**
 * Builds the HTML content shown inside an info window.
 * @param {import('../../bot/src/types/mapPin').MapPin} pin
 * @returns {string}
 */
function buildInfoWindowContent(pin) {
  const date = formatDate(pin.createdAt);
  const discordLink = discordMessageLink(pin.guildId, pin.channelId, pin.messageId);
  const caption = pin.caption
    ? `<p class="caption">${pin.caption.replace(/</g, '&lt;')}</p>`
    : '';
  return `
    <div class="info-window">
      <img src="${pin.imageUrl}" alt="MunchHat photo" loading="lazy" />
      ${caption}
      <p class="meta">📅 ${date}</p>
      <p class="meta">👤 ${pin.userId}</p>
      <a href="${discordLink}" target="_blank" rel="noopener noreferrer">
        View original message →
      </a>
    </div>
  `;
}

/**
 * Renders all pins as Google Maps markers with info windows.
 * @param {google.maps.Map} map
 * @param {Array} pins
 */
export function renderPins(map, pins) {
  const infoWindow = new google.maps.InfoWindow();

  for (const pin of pins) {
    const marker = new google.maps.Marker({
      position: { lat: pin.lat, lng: pin.lng },
      map,
      title: pin.caption ?? `Pin by ${pin.userId}`,
    });

    marker.addListener('click', () => {
      infoWindow.setContent(buildInfoWindowContent(pin));
      infoWindow.open(map, marker);
    });
  }
}
