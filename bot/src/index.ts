import { Client, GatewayIntentBits, Events, REST, Routes, SlashCommandBuilder, ChatInputCommandInteraction, ChannelType } from 'discord.js';
import { handleMessage } from './handlers/messageHandler.js';
import { handleImport } from './handlers/importHandler/index.js';

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  console.error('[bot] Unhandled promise rejection:', message);
});

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error('DISCORD_BOT_TOKEN environment variable is required');
  process.exit(1);
}

const importCommand = new SlashCommandBuilder()
  .setName('munchhat-import')
  .setDescription('Import past #munchhat pins from channel history')
  .addStringOption((opt) =>
    opt
      .setName('lookback')
      .setDescription('How far back to scan, e.g. 1d, 7d, 2w, 3M, 1y (default: all history)')
      .setRequired(false),
  )
  .addStringOption((opt) =>
    opt
      .setName('verbosity')
      .setDescription('How much detail to include in the output (default: standard)')
      .setRequired(false)
      .addChoices(
        { name: 'standard', value: 'standard' },
        { name: 'verbose', value: 'verbose' },
        { name: 'debug', value: 'debug' },
      ),
  )
  .addStringOption((opt) =>
    opt
      .setName('message')
      .setDescription('Import a single message by its Discord link (e.g. https://discord.com/channels/…)')
      .setRequired(false),
  )
  .addChannelOption((opt) =>
    opt
      .setName('channel')
      .setDescription('Scan a different channel (results posted here)')
      .setRequired(false)
      .addChannelTypes(ChannelType.GuildText),
  )
  .addStringOption((opt) =>
    opt
      .setName('force-location')
      .setDescription('Override geocoding with this text — requires message param, overwrites existing pin if present')
      .setRequired(false),
  )
  .addBooleanOption((opt) =>
    opt
      .setName('force')
      .setDescription('Re-run the full geocoding pipeline and overwrite the existing pin — requires message param')
      .setRequired(false),
  );

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
