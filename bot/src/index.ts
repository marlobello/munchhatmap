import { Client, GatewayIntentBits, Events, REST, Routes, SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { handleMessage } from './handlers/messageHandler.js';
import { handleImport } from './handlers/importHandler.js';

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error('DISCORD_BOT_TOKEN environment variable is required');
  process.exit(1);
}

const importCommand = new SlashCommandBuilder()
  .setName('munchhat-import')
  .setDescription('Scan this channel\'s history and import past #munchhat pins (admin only)')
  .setDefaultMemberPermissions('0'); // hidden from non-admins in the UI; enforced at runtime too

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // Privileged intent — must be enabled in Discord Developer Portal
  ],
});

client.once(Events.ClientReady, async (c) => {
  console.log(`[bot] Logged in as ${c.user.tag}`);
  console.log(`[bot] Watching for tags: ${process.env.MAP_TRIGGER_TAGS ?? '#munchhat,#munchhatchronicles'}`);

  // Register slash command globally (may take up to 1 hour to propagate to all servers)
  const rest = new REST().setToken(token!);
  try {
    await rest.put(Routes.applicationCommands(c.user.id), {
      body: [importCommand.toJSON()],
    });
    console.log('[bot] Slash command /munchhat-import registered');
  } catch (err) {
    console.error('[bot] Failed to register slash commands:', err);
  }
});

client.on(Events.MessageCreate, (message) => {
  handleMessage(message).catch((err) => {
    console.error('[bot] Unhandled error in messageCreate handler:', err);
  });
});

client.on(Events.InteractionCreate, (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === 'munchhat-import') {
    handleImport(interaction as ChatInputCommandInteraction).catch((err) => {
      console.error('[bot] Unhandled error in munchhat-import handler:', err);
    });
  }
});

client.login(token);
