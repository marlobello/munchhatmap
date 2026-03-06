import { Client, GatewayIntentBits, Events } from 'discord.js';
import { handleMessage } from './handlers/messageHandler.js';

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error('DISCORD_BOT_TOKEN environment variable is required');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // Privileged intent — must be enabled in Discord Developer Portal
  ],
});

client.once(Events.ClientReady, (c) => {
  console.log(`[bot] Logged in as ${c.user.tag}`);
  console.log(`[bot] Watching for tags: ${process.env.MAP_TRIGGER_TAGS ?? '#munchhat,#munchhatchronicles'}`);
});

client.on(Events.MessageCreate, (message) => {
  handleMessage(message).catch((err) => {
    console.error('[bot] Unhandled error in messageCreate handler:', err);
  });
});

client.login(token);
