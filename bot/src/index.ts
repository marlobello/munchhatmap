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
  .setDescription('Scan this channel\'s history and import past #munchhat pins (MOD or Manage Server only)');

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

  // Register slash commands in all current guilds
  for (const guild of c.guilds.cache.values()) {
    await registerCommands(c.user.id, guild.id);
  }
});

// Register commands when the bot is added to a new guild
client.on(Events.GuildCreate, async (guild) => {
  await registerCommands(client.user!.id, guild.id);
});

async function registerCommands(appId: string, guildId: string): Promise<void> {
  const rest = new REST().setToken(token!);
  try {
    await rest.put(Routes.applicationGuildCommands(appId, guildId), {
      body: [importCommand.toJSON()],
    });
    console.log(`[bot] Slash commands registered for guild ${guildId}`);
  } catch (err) {
    console.error(`[bot] Failed to register commands for guild ${guildId}:`, err);
  }
}

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
