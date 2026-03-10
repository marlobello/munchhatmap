/**
 * map.js — marker rendering, popup logic, and drag-to-relocate for MunchHat Map.
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
  const safeLink = isSafeSnowflake(pin.guildId) && isSafeSnowflake(pin.channelId) && isSafeSnowflake(pin.messageId)
    ? discordMessageLink(pin.guildId, pin.channelId, pin.messageId)
    : null;
  const caption = pin.caption
    ? `<p class="caption">${escapeHtml(pin.caption)}</p>`
    : '';
  const author = pin.username ? `@${escapeHtml(pin.username)}` : escapeHtml(`<${pin.userId}>`);
  const discordLinkHtml = safeLink
    ? `<a href="${escapeAttr(safeLink)}" target="_blank" rel="noopener noreferrer">View original message →</a>`
    : '';
  return `
    <div class="popup-content">
      <img class="popup-photo" src="${escapeAttr(pin.imageUrl)}" alt="MunchHat photo" loading="lazy" />
      <div class="popup-img-error" style="display:none">
        <img src="/munchhat.png" alt="" class="popup-img-error-icon" />
        <p>📷 Image no longer available</p>
        ${discordLinkHtml}
      </div>
      ${caption}
      <p class="meta">📅 ${date}</p>
      <p class="meta">👤 ${author}</p>
      ${safeLink ? `<div class="popup-discord-link">${discordLinkHtml}</div>` : ''}
    </div>
  `;
}

// ─── Drag confirmation dialog ────────────────────────────────────────────────

let _dialog = null;

function getDialog() {
  if (_dialog) return _dialog;
  _dialog = document.createElement('div');
  _dialog.id = 'pin-move-dialog';
  _dialog.style.cssText = `
    display:none; position:fixed; bottom:24px; left:50%; transform:translateX(-50%);
    background:#1e1e2e; color:#cdd6f4; border-radius:12px; padding:14px 20px;
    box-shadow:0 4px 24px rgba(0,0,0,.45); z-index:9999; font-family:inherit;
    font-size:14px; white-space:nowrap; min-width:260px; text-align:center;
  `;
  _dialog.innerHTML = `
    <p id="pin-move-msg" style="margin:0 0 10px"></p>
    <div style="display:flex;gap:10px;justify-content:center">
      <button id="pin-move-confirm" style="
        background:#a6e3a1;color:#1e1e2e;border:none;border-radius:8px;
        padding:6px 18px;cursor:pointer;font-weight:600;font-size:13px">✓ Confirm</button>
      <button id="pin-move-cancel" style="
        background:#f38ba8;color:#1e1e2e;border:none;border-radius:8px;
        padding:6px 18px;cursor:pointer;font-weight:600;font-size:13px">✕ Cancel</button>
    </div>
  `;
  document.body.appendChild(_dialog);
  return _dialog;
}

/**
 * Shows the confirmation dialog for a pin move.
 * Returns a Promise that resolves to true (confirmed) or false (cancelled/error).
 */
function showMoveDialog(lat, lng) {
  return new Promise((resolve) => {
    const dialog = getDialog();
    const msg = dialog.querySelector('#pin-move-msg');
    const confirmBtn = dialog.querySelector('#pin-move-confirm');
    const cancelBtn = dialog.querySelector('#pin-move-cancel');

    msg.textContent = `📍 Move pin to ${lat.toFixed(5)}, ${lng.toFixed(5)}?`;
    confirmBtn.disabled = false;
    cancelBtn.disabled = false;
    confirmBtn.textContent = '✓ Confirm';
    dialog.style.display = 'block';

    function cleanup() {
      dialog.style.display = 'none';
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
    }
    function onConfirm() {
      confirmBtn.disabled = true;
      cancelBtn.disabled = true;
      confirmBtn.textContent = '⏳';
      cleanup();
      resolve(true);
    }
    function onCancel() {
      cleanup();
      resolve(false);
    }
    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
  });
}

function showMoveError(msg) {
  const dialog = getDialog();
  const msgEl = dialog.querySelector('#pin-move-msg');
  const confirmBtn = dialog.querySelector('#pin-move-confirm');
  const cancelBtn = dialog.querySelector('#pin-move-cancel');
  msgEl.textContent = `❌ ${msg}`;
  confirmBtn.style.display = 'none';
  cancelBtn.textContent = '✕ Close';
  cancelBtn.disabled = false;
  dialog.style.display = 'block';
  cancelBtn.addEventListener('click', () => {
    dialog.style.display = 'none';
    confirmBtn.style.display = '';
    cancelBtn.textContent = '✕ Cancel';
  }, { once: true });
}

// ─── Marker builder ──────────────────────────────────────────────────────────

/**
 * Builds a Leaflet marker for a pin. Enables dragging if the current user
 * owns the pin or has elevated (MOD) permissions.
 *
 * @param {object} pin
 * @param {object|null} user
 * @param {Function} authedFetch
 * @param {string} apiBase
 * @returns {L.Marker}
 */
function buildMarker(pin, user, authedFetch, apiBase) {
  const canDrag = !!(user && (user.userId === pin.userId || user.isElevated));
  const marker = L.marker([pin.lat, pin.lng], { icon: hatIcon, draggable: canDrag });
  marker.bindPopup(buildPopupContent(pin), { maxWidth: 280 });

  if (canDrag) {
    let originalLatLng = marker.getLatLng();

    marker.on('dragstart', () => {
      // Close popup if open while dragging
      if (marker.isPopupOpen()) marker.closePopup();
    });

    marker.on('dragend', async () => {
      const newLatLng = marker.getLatLng();
      const confirmed = await showMoveDialog(newLatLng.lat, newLatLng.lng);

      if (!confirmed) {
        marker.setLatLng(originalLatLng);
        return;
      }

      try {
        const res = await authedFetch(`${apiBase}/updatePin`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pinId: pin.id,
            guildId: pin.guildId,
            lat: newLatLng.lat,
            lng: newLatLng.lng,
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          showMoveError(err.error ?? `Server error (${res.status})`);
          marker.setLatLng(originalLatLng);
          return;
        }

        const updated = await res.json();
        // Commit new position as the new "original" for future drags
        originalLatLng = newLatLng;
        // Update pin metadata so popup shows fresh info
        pin.lat        = updated.lat;
        pin.lng        = updated.lng;
        pin.country    = updated.country;
        pin.state      = updated.state;
        pin.place_name = updated.place_name;
        marker.setPopupContent(buildPopupContent(pin));
      } catch (err) {
        showMoveError('Network error — please try again.');
        marker.setLatLng(originalLatLng);
      }
    });
  }

  return marker;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Renders all pins as Leaflet markers with popups and optional drag-to-relocate.
 * @param {L.Map} map
 * @param {Array} pins
 * @param {object|null} user  — current session user (from /api/auth/me)
 * @param {Function} authedFetch  — authenticated fetch helper from main.js
 * @param {string} apiBase  — API base URL
 */
export function renderPins(map, pins, user = null, authedFetch = fetch, apiBase = '/api') {
  const cluster = L.markerClusterGroup({ chunkedLoading: true });
  for (const pin of pins) {
    const marker = buildMarker(pin, user, authedFetch, apiBase);
    cluster.addLayer(marker);
  }
  map.addLayer(cluster);

  // CSP-safe image error handler: swap broken image for placeholder + Discord link.
  map.on('popupopen', (e) => {
    const el = e.popup.getElement();
    if (!el) return;
    const img = el.querySelector('img.popup-photo');
    const errorDiv = el.querySelector('.popup-img-error');
    const discordLinkDiv = el.querySelector('.popup-discord-link');
    if (!img || !errorDiv) return;
    img.addEventListener('error', () => {
      img.style.display = 'none';
      errorDiv.style.display = '';
      if (discordLinkDiv) discordLinkDiv.style.display = 'none';
    }, { once: true });
  });
}

