export interface MapPin {
  id: string;         // UUID
  guildId: string;    // Discord server ID (partition key)
  channelId: string;  // Channel where posted
  messageId: string;  // Original Discord message ID
  userId: string;     // Discord user ID
  username?: string;  // Discord username at time of posting
  lat: number;
  lng: number;
  imageUrl: string;   // Discord CDN URL
  createdAt: string;  // ISO 8601 timestamp
  caption?: string;   // Optional message text
  tagUsed?: string;   // e.g. "#munchhat"
  country?: string;   // Country name from reverse geocoding
  state?: string;     // US state name (populated for US pins only)
  place_name?: string; // Specific place name from geocoding
}
