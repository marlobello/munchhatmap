export interface MapPin {
  id: string;
  guildId: string;
  channelId: string;
  messageId: string;
  userId: string;
  username?: string;
  lat: number;
  lng: number;
  imageUrl: string;
  createdAt: string;
  caption?: string;
  tagUsed?: string;
  country?: string;
  state?: string;
}
