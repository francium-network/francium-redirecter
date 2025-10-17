import dotenv from "dotenv";
dotenv.config();
import {
    Client, GatewayIntentBits, Partials, ChannelType, PermissionsBitField,
    EmbedBuilder, AttachmentBuilder, ActionRowBuilder, StringSelectMenuBuilder
} from 'discord.js';

/**
 * ProxyBotAPI - A modular Discord proxy bot that can be used as an addon
 */
class ProxyBotAPI {
    constructor(options = {}) {
        // Configuration
        this.config = {
            botToken: options.botToken || process.env.BOT_TOKEN,
            verifiedRoleName: options.verifiedRoleName || process.env.VERIFIED_ROLE_NAME,
            proxyAPI: options.proxyAPI || null,
            ...options
        };

        // Validate required dependencies
        if (!this.config.botToken) {
            throw new Error('BOT_TOKEN is required in options or environment variables');
        }
        if (!this.config.proxyAPI) {
            throw new Error('proxyAPI instance is required in options');
        }

        // Constants
        this.typeToUrl = {
            "acceleration": "141.148.134.230",
            "afiliteos": "152.53.80.107",
            "ajh_vault": "ajh.college",
            "arsenic": "arsenic.smartfoloo.space",
            "artclass": "artclass.site",
            "astroid": "astroid.gg",
            "bolt": "104.36.86.24",
            "boredom": "boredomarcade.xyz",
            "bromine": "129.153.136.235",
            "canlite": "canlite.org",
            "carbon": "163.192.96.222",
            "compass": "compass-network.online",
            "daydreamx": "daydreamx.pro",
            "doge": "172.96.141.252",
            "emerald_and_phantom": "phantomgames.dev",
            "extremeMath": "152.53.38.152",
            "frogiees_arcade": "frogiesarcade.win",
            "galaxy": "galacticsurf.boats",
            "ghost": "104.36.84.230",
            "gn-math": "gn-math.dev",
            "interstellar": "gointerstellar.app",
            "jordan's Math Work": "37.27.88.135",
            "kazwire": "kazwire.com",
            "luminalOS": "152.53.210.103",
            "lunaar": "164.152.26.189",
            "lunar": "172.93.101.204",
            "petezah_old": "62.72.3.251",
            "petezah_new": "petezahgames.com",
            "spectre": "70.123.74.99",
            "radius": "147.160.139.153",
            "rammerhead": "direct2.rammerhead.org",
            "rammerhead_premium": "browser.rammerhead.org",
            "reds Exploit Center": "152.53.37.155",
            "saturn": "saturnproxy.games",
            "selenite": "selenite.cc",
            "shadow": "phantom.lol",
            "space": "gointospace.app",
            //fuck szvy
            "pizza_edition": "104.36.84.31",
            "truffled": "truffled.lol",
            "thepegleg": "104.36.86.105",
            "uniub": "152.53.18.128",
            "us5": "89.58.60.170",
            "utopia": " 104.218.50.66",
            "vapor": "vaporon.top",
            "velera": "velara.cc",
            "void": "15.204.209.18",
            "void_secret": "169.60.151.233",
            "voidos": "172.93.100.159",
            "waves": "152.53.209.16"
        };

        this.filters = ["lightspeed", "securly", "no-filter-all-links"];
        this.validTypes = Object.keys(this.typeToUrl);
        this.CATEGORY_NAME = "Links";
        this.CACHE_DURATION = 3600 * 1000; // 1 hour
        this.MAX_FETCH_RETRIES = 3;
        this.DISCORD_MAX_FILE_SIZE = 8 * 1024 * 1024; // 8 MB
        this.CHOICES_LIMIT = 25; // Discord's limit for choices in a command option

        // State
        this.proxyCache = {};
        this.requestQueue = {};
        this.isBotReady = false;
        this.isUpdating = false;
        this.client = null;

        // Initialize cache structure
        this.initializeCache();
    }

    /**
     * Initialize the cache structure
     */
    initializeCache() {
        this.filters.forEach(filter => {
            this.proxyCache[filter] = {};
            this.requestQueue[filter] = {};
            this.validTypes.forEach(type => {
                this.proxyCache[filter][type] = { data: [], timestamp: 0, isFetching: false };
                this.requestQueue[filter][type] = [];
            });
        });
    }

    /**
     * Create and start the Discord bot
     */
    async createBot() {
        if (this.client) {
            throw new Error('Bot already exists. Use destroyBot() first if you need to recreate it.');
        }

        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
            ],
            partials: [Partials.Channel],
        });

        this.setupEventHandlers();

        try {
            await this.client.login(this.config.botToken);
            return this.client;
        } catch (error) {
            throw new Error(`Failed to login: ${error.message}`);
        }
    }

    /**
     * Destroy the Discord bot
     */
    async destroyBot() {
        if (this.client) {
            await this.client.destroy();
            this.client = null;
            this.isBotReady = false;
        }
    }

    /**
     * Get proxies with caching (main API method)
     */
    async getProxies(type, filter, count = 1000, options = {}) {
        const { forceRefresh = false, maxAge = this.CACHE_DURATION } = options;

        if (!this.validTypes.includes(type)) {
            throw new Error(`Invalid proxy type: ${type}. Valid types: ${this.validTypes.join(', ')}`);
        }
        if (!this.filters.includes(filter)) {
            throw new Error(`Invalid filter: ${filter}. Valid filters: ${this.filters.join(', ')}`);
        }

        const cacheEntry = this.proxyCache[filter][type];
        const isCacheValid = !forceRefresh && (Date.now() - cacheEntry.timestamp) < maxAge;

        // Return cached data if valid
        if (isCacheValid && cacheEntry.data.length > 0) {
            return {
                success: true,
                data: cacheEntry.data.slice(0, count),
                total: cacheEntry.data.length,
                cached: true,
                timestamp: cacheEntry.timestamp
            };
        }

        // If already fetching, wait for it to complete
        if (cacheEntry.isFetching) {
            return new Promise((resolve, reject) => {
                this.requestQueue[filter][type].push(() => {
                    try {
                        resolve({
                            success: true,
                            data: cacheEntry.data.slice(0, count),
                            total: cacheEntry.data.length,
                            cached: false,
                            timestamp: cacheEntry.timestamp
                        });
                    } catch (error) {
                        reject(error);
                    }
                });
            });
        }

        // Start new fetch
        cacheEntry.isFetching = true;

        try {
            const newProxies = await this.fetchProxiesWithRetry(type, filter);
            
            // Update cache
            cacheEntry.data = newProxies;
            cacheEntry.timestamp = Date.now();

            // Process queued requests
            const queuedRequests = this.requestQueue[filter][type];
            while (queuedRequests.length > 0) {
                const queuedTask = queuedRequests.shift();
                try {
                    await queuedTask();
                } catch (error) {
                    console.error('Error processing queued request:', error);
                }
            }

            // Update Discord channels if bot is running
            if (this.client && this.isBotReady) {
                await this.updateProxyTypeChannel(type, filter);
                await this.updateSummaryChannel(filter);
            }

            return {
                success: true,
                data: newProxies.slice(0, count),
                total: newProxies.length,
                cached: false,
                timestamp: cacheEntry.timestamp
            };

        } catch (error) {
            // Clear queued requests on error
            this.requestQueue[filter][type] = [];
            throw error;
        } finally {
            cacheEntry.isFetching = false;
        }
    }

    /**
     * Get all cached proxies for a filter across all types
     */
    getAllProxiesForFilter(filter) {
        if (!this.filters.includes(filter)) {
            throw new Error(`Invalid filter: ${filter}. Valid filters: ${this.filters.join(', ')}`);
        }

        const allProxies = new Set();
        let oldestTimestamp = Date.now();

        this.validTypes.forEach(type => {
            const cacheEntry = this.proxyCache[filter][type];
            if (cacheEntry.data.length > 0) {
                cacheEntry.data.forEach(proxy => allProxies.add(proxy));
                oldestTimestamp = Math.min(oldestTimestamp, cacheEntry.timestamp);
            }
        });

        return {
            success: true,
            data: [...allProxies],
            total: allProxies.size,
            cached: true,
            timestamp: oldestTimestamp
        };
    }

    /**
     * Get cache status for all types and filters
     */
    getCacheStatus() {
        const status = {};
        
        this.filters.forEach(filter => {
            status[filter] = {};
            this.validTypes.forEach(type => {
                const cacheEntry = this.proxyCache[filter][type];
                status[filter][type] = {
                    count: cacheEntry.data.length,
                    timestamp: cacheEntry.timestamp,
                    age: Date.now() - cacheEntry.timestamp,
                    isValid: (Date.now() - cacheEntry.timestamp) < this.CACHE_DURATION,
                    isFetching: cacheEntry.isFetching
                };
            });
        });

        return status;
    }

    /**
     * Clear cache for specific type/filter or all
     */
    clearCache(type = null, filter = null) {
        if (type && filter) {
            // Clear specific cache entry
            if (this.proxyCache[filter] && this.proxyCache[filter][type]) {
                this.proxyCache[filter][type] = { data: [], timestamp: 0, isFetching: false };
                this.requestQueue[filter][type] = [];
            }
        } else if (filter) {
            // Clear all types for a filter
            this.validTypes.forEach(t => this.clearCache(t, filter));
        } else if (type) {
            // Clear all filters for a type
            this.filters.forEach(f => this.clearCache(type, f));
        } else {
            // Clear everything
            this.initializeCache();
        }
    }

    /**
     * Start automated cache updates
     */
    startAutomatedUpdates(interval = this.CACHE_DURATION) {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }

        this.updateInterval = setInterval(() => {
            this.automatedUpdate();
        }, interval);

        // Run first update immediately
        setTimeout(() => this.automatedUpdate(), 1000);
    }

    /**
     * Stop automated cache updates
     */
    stopAutomatedUpdates() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }

    // --- Private Methods ---
    
    _chunkArray(arr, size) {
        const chunks = [];
        for (let i = 0; i < arr.length; i += size) {
            chunks.push(arr.slice(i, i + size));
        }
        return chunks;
    }

    setupEventHandlers() {
        this.client.once('ready', async () => {
            console.log(`Logged in as ${this.client.user.tag}`);
            console.log('Registering global slash commands...');

            const commandsToRegister = [];
            const typeChunks = this._chunkArray(this.validTypes, this.CHOICES_LIMIT);

            // Create getproxies commands based on the number of types
            typeChunks.forEach((chunk, index) => {
                const commandName = index === 0 ? 'getproxies' : `getproxiesmore${index === 1 ? '' : index}`;
                const description = index === 0
                    ? 'Fetches a list of proxies and sends them to your DMs.'
                    : `More proxy types to choose from (Part ${index + 1}).`;

                const command = {
                    name: commandName,
                    description: description,
                    options: [{
                        name: 'type', description: 'The type of proxy to fetch', type: 3, required: true,
                        choices: chunk.map(type => ({ name: type, value: type }))
                    }, {
                        name: 'filter', description: 'The filter to check against', type: 3, required: true,
                        choices: this.filters.map(filter => ({ name: filter, value: filter }))
                    }, {
                        name: 'count', description: 'Number of proxies to fetch (max 1000)', type: 4, required: true, min_value: 1, max_value: 1000
                    }]
                };
                commandsToRegister.push(command);
            });

            // Add other static commands
            commandsToRegister.push({
                name: 'proxymenu',
                description: 'Interactively browse cached proxy lists without triggering a new fetch.',
            }, {
                name: 'reset',
                description: 'Admin only: Deletes and recreates ALL bot-related channels.',
                default_member_permissions: PermissionsBitField.Flags.Administrator.toString(),
            });

            try {
                await this.client.application.commands.set(commandsToRegister);
                console.log('Global slash commands registered successfully.');
            } catch (error) {
                console.error('Failed to register global slash commands:', error);
            }
            
            // Initial setup for all guilds
            for (const guild of this.client.guilds.cache.values()) {
                await this.setupGuildChannels(guild);
            }
            
            this.isBotReady = true;
            this.startAutomatedUpdates();
        });

        this.client.on('guildCreate', async (guild) => {
            console.log(`Joined new guild: ${guild.name} (${guild.id})`);
            await this.setupGuildChannels(guild);
            await this.populateNewGuildChannels(guild);
        });

        this.client.on('interactionCreate', async (interaction) => {
            if (!this.isBotReady) {
                if (interaction.isRepliable()) {
                    await interaction.reply({ content: 'Bot is still starting up, please wait...', ephemeral: true });
                }
                return;
            }
            
            if (interaction.isCommand()) {
                await this.handleCommand(interaction);
            } else if (interaction.isStringSelectMenu()) {
                await this.handleSelectMenu(interaction);
            }
        });
    }

    async fetchProxiesWithRetry(type, filter) {
        for (let attempt = 1; attempt <= this.MAX_FETCH_RETRIES; attempt++) {
            try {
                const allWebsites = await this.fetchRawProxies(type);
                if (filter === 'no-filter-all-links') return allWebsites;
                if (!allWebsites.length) return [];
                
                const checkedWebsites = await this.config.proxyAPI.checkWebsites(allWebsites, filter);
                return allWebsites.filter((_, i) => checkedWebsites[i] === false);

            } catch (error) {
                console.warn(`[Attempt ${attempt}/${this.MAX_FETCH_RETRIES}] Fetch failed for ${type}/${filter}: ${error.message}`);
                if (attempt === this.MAX_FETCH_RETRIES) {
                    throw new Error(`Failed to fetch proxies after ${this.MAX_FETCH_RETRIES} attempts: ${error.message}`);
                }
                await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
            }
        }
        return [];
    }

    async fetchRawProxies(type) {
        if (!this.typeToUrl[type]) {
            throw new Error(`Invalid proxy type: ${type}`);
        }
        return await this.config.proxyAPI.getAllWebsites(this.typeToUrl[type]);
    }

    async automatedUpdate() {
        if (this.isUpdating) {
            console.warn("Automated update cycle skipped: previous cycle still running.");
            return;
        }
        
        console.log("Starting automated cache update cycle...");
        this.isUpdating = true;

        try {
            for (const type of this.validTypes) {
                for (const filter of this.filters) {
                    console.log(`Updating cache: ${type} -> ${filter}`);
                    try {
                        const proxies = await this.fetchProxiesWithRetry(type, filter);
                        this.proxyCache[filter][type].data = proxies;
                        this.proxyCache[filter][type].timestamp = Date.now();
                        
                        if (this.client && this.isBotReady) {
                            await this.updateProxyTypeChannel(type, filter);
                        }
                    } catch (error) {
                        console.error(`Failed to update ${type}/${filter}:`, error);
                    }
                }
            }
            
            if (this.client && this.isBotReady) {
                await this.updateSummaryChannel('lightspeed');
                await this.updateSummaryChannel('securly');
                await this.updateSummaryChannel('all');
            }
            
            console.log("Automated cache update cycle finished.");

        } catch (error) {
            console.error("Error during automated update cycle:", error);
        } finally {
            this.isUpdating = false;
        }
    }

    // Discord-specific methods
    async handleCommand(interaction) {
        const { commandName } = interaction;

        // Route all 'getproxies...' commands to the same handler
        if (commandName.startsWith('getproxies')) {
            await this.handleGetProxiesCommand(interaction);
            return;
        }
        
        switch (commandName) {
            case 'proxymenu':
                await this.handleProxyMenuCommand(interaction);
                break;
            case 'reset':
                await this.handleResetCommand(interaction);
                break;
            default:
                if (interaction.isRepliable()) {
                    await interaction.reply({ content: 'Unknown command.', ephemeral: true });
                }
        }
    }

    async handleGetProxiesCommand(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const type = interaction.options.getString('type');
        const filter = interaction.options.getString('filter');
        const count = interaction.options.getInteger('count');
        
        try {
            const result = await this.getProxies(type, filter, count);
            await this.sendProxiesToUser(interaction, type, filter, result);
        } catch (error) {
            console.error('Error in getproxies command:', error);
            await interaction.editReply(`❌ Error: ${error.message}`);
        }
    }

    async sendProxiesToUser(interaction, type, filter, result) {
        const { data: proxies, total, cached } = result;
        
        if (proxies.length === 0) {
            const message = `No working proxies found for "${type}" with "${filter}" filter.`;
            try {
                await interaction.user.send(message);
                await interaction.editReply('No proxies found. Check your DMs for details.');
            } catch (dmError) {
                await interaction.editReply(message + '\n\n(Failed to DM - check privacy settings)');
            }
            return;
        }
        
        let fileContent = proxies.join('\n');
        let truncated = false;

        if (Buffer.byteLength(fileContent, 'utf-8') > this.DISCORD_MAX_FILE_SIZE) {
            fileContent = Buffer.from(fileContent, 'utf-8').slice(0, this.DISCORD_MAX_FILE_SIZE - 500).toString('utf-8');
            fileContent = fileContent.slice(0, fileContent.lastIndexOf('\n'));
            fileContent += '\n\n... (truncated to fit Discord limits)';
            truncated = true;
        }

        const attachment = new AttachmentBuilder(Buffer.from(fileContent, 'utf-8'), { 
            name: `${type}-${filter}-proxies.txt` 
        });

        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle(`🔗 ${type} Proxies`)
            .setDescription(`**${proxies.length}** of ${total} available proxies for **${filter}** filter.`)
            .addFields(
                { name: 'Type', value: type, inline: true },
                { name: 'Filter', value: filter, inline: true },
                { name: 'Source', value: cached ? 'Cache' : 'Fresh', inline: true }
            )
            .setTimestamp();
        
        if (truncated) {
            embed.addFields({ name: '⚠️ Warning', value: 'List truncated due to size limits.' });
        }

        try {
            await interaction.user.send({ embeds: [embed], files: [attachment] });
            await interaction.editReply(`✅ Sent ${proxies.length} proxies to your DMs!`);
        } catch (dmError) {
            await interaction.editReply({ 
                content: `❌ Could not DM you. Here are your proxies:`,
                embeds: [embed], 
                files: [attachment]
            });
        }
    }

    async handleSelectMenu(interaction) {
        const { customId } = interaction;

        if (customId.startsWith('proxy_type_select')) {
            await this.handleProxyTypeSelection(interaction);
        } else if (customId === 'proxy_filter_select') {
            await this.handleProxyFilterSelection(interaction);
        } else {
            if (interaction.isRepliable()) {
                await interaction.reply({ content: 'Unknown menu selection.', ephemeral: true });
            }
        }
    }

    async handleResetCommand(interaction) {
        if (!interaction.inGuild()) {
            return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
        }
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        const guild = interaction.guild;
        console.log(`[${guild.name}] Channel reset initiated by ${interaction.user.tag}`);
        await interaction.editReply('Starting cleanup: deleting all bot channels and category...');
        
        const botChannelNames = [...this.validTypes, 'all-proxies-lightspeed', 'all-proxies-securly', 'all-proxies'];
        
        // Delete all bot channels
        for (const channelName of botChannelNames) {
            const channel = guild.channels.cache.find(c => c.name === channelName && c.type === ChannelType.GuildText);
            if (channel) {
                try {
                    await channel.delete(`Reset by ${interaction.user.tag}`);
                } catch (error) {
                    console.error(`Could not delete channel ${channel.name}:`, error);
                }
            }
        }

        // Delete category
        const category = guild.channels.cache.find(c => c.name === this.CATEGORY_NAME && c.type === ChannelType.GuildCategory);
        if (category) {
            try {
                await category.delete(`Reset by ${interaction.user.tag}`);
            } catch (error) {
                console.error('Could not delete category:', error);
            }
        }
        
        await interaction.editReply('Cleanup complete. Rebuilding all channels...');

        await this.setupGuildChannels(guild);
        await this.populateNewGuildChannels(guild);

        return interaction.editReply('✅ Channel reset and rebuild complete!');
    }

    async handleProxyMenuCommand(interaction) {
        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('🔗 Proxy Browser Menu')
            .setDescription('Select a proxy type below to view its cached data. The list is split into multiple dropdowns if it exceeds 25 items.')
            .setFooter({ text: 'All data is from the bot\'s local cache.' });

        const typeChunks = this._chunkArray(this.validTypes, this.CHOICES_LIMIT);
        const actionRows = [];

        if (typeChunks.length === 0) {
            embed.setDescription('No proxy types are configured for this bot.');
            await interaction.reply({ embeds: [embed], ephemeral: true });
            return;
        }

        typeChunks.forEach((chunk, index) => {
            const typeOptions = chunk.map(type => {
                let totalCount = this.filters.reduce((sum, filter) => {
                    return sum + (this.proxyCache[filter][type]?.data?.length || 0);
                }, 0);
                return {
                    label: type,
                    value: type,
                    description: `${totalCount} total cached proxies`,
                };
            });

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`proxy_type_select_${index}`)
                .setPlaceholder(`Choose a proxy type... (Part ${index + 1}/${typeChunks.length})`)
                .addOptions(typeOptions);
            
            actionRows.push(new ActionRowBuilder().addComponents(selectMenu));
        });

        await interaction.reply({ embeds: [embed], components: actionRows, ephemeral: true });
    }

    async handleProxyTypeSelection(interaction) {
        const selectedType = interaction.values[0];
        
        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(`📊 Cache Status for: ${selectedType}`)
            .setDescription('Select a filter to view its specific cached proxy list.')
            .setTimestamp();

        const filterOptions = this.filters.map(filter => {
            const cacheEntry = this.proxyCache[filter][selectedType];
            const count = cacheEntry?.data?.length || 0;
            const lastUpdated = cacheEntry?.timestamp ? `<t:${Math.floor(cacheEntry.timestamp / 1000)}:R>` : 'Never';
            return {
                label: filter.replace(/-/g, ' '),
                value: `${selectedType}:${filter}`,
                description: `${count} proxies | Updated: ${lastUpdated}`,
            };
        });

        const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('proxy_filter_select')
                .setPlaceholder('Choose a filter...')
                .addOptions(filterOptions)
        );

        await interaction.update({ embeds: [embed], components: [row] });
    }

    async handleProxyFilterSelection(interaction) {
        await interaction.deferUpdate();
        const [selectedType, selectedFilter] = interaction.values[0].split(':');
        
        const cacheEntry = this.proxyCache[selectedFilter][selectedType];
        const proxies = cacheEntry?.data || [];
        const lastUpdated = cacheEntry?.timestamp ? new Date(cacheEntry.timestamp) : null;
        
        if (proxies.length === 0) {
            await interaction.editReply({ 
                embeds: [new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle(`❌ No Cached Proxies`)
                    .setDescription(`No data found for **${selectedType}** with **${selectedFilter}** filter.`)],
                components: []
            });
            return;
        }

        const fileContent = proxies.join('\n');
        const attachment = new AttachmentBuilder(
            Buffer.from(fileContent, 'utf-8'), 
            { name: `cached-${selectedType}-${selectedFilter}.txt` }
        );

        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle(`📋 Cached Proxies: ${selectedType} / ${selectedFilter}`)
            .setDescription(`Found **${proxies.length}** cached proxies.`)
            .addFields({ 
                name: 'Last Updated', 
                value: lastUpdated ? `<t:${Math.floor(lastUpdated.getTime() / 1000)}:F>` : 'Unknown', 
                inline: true 
            })
            .setFooter({ text: 'This data is from the cache. Use /getproxies to fetch fresh data.' });

        try {
            await interaction.user.send({ embeds: [embed], files: [attachment] });
            await interaction.editReply({ 
                embeds: [new EmbedBuilder()
                    .setColor(0x00FF00)
                    .setTitle('✅ Sent to your DMs!')
                    .setDescription(`The list of ${proxies.length} cached proxies has been sent to your DMs.`)],
                components: []
            });
        } catch (dmError) {
            await interaction.editReply({ 
                content: `⚠️ Could not DM you. Here is the file instead:`,
                embeds: [embed],
                files: [attachment],
                components: []
            });
        }
    }

    async updateProxyTypeChannel(type, filter, singleGuild = null) {
        if (!this.client || !this.isBotReady) return;

        const proxies = this.proxyCache[filter][type].data;
        const embedTitle = `${filter.replace(/-/g, ' ')} Links`;
        const embed = new EmbedBuilder()
            .setColor(proxies.length > 0 ? 0x00FF00 : 0xFF0000)
            .setTitle(embedTitle)
            .setDescription(`Found **${proxies.length}** working links.`)
            .setFooter({ text: `Type: ${type} • Last Updated` })
            .setTimestamp();
            
        const fileContent = proxies.length > 0 ? proxies.join('\n') : "No working links found at this time.";
        const attachment = new AttachmentBuilder(
            Buffer.from(fileContent, 'utf-8'), 
            { name: `${type}-${filter}.txt` }
        );
        
        const guildsToUpdate = singleGuild ? [singleGuild] : this.client.guilds.cache.values();
        for (const guild of guildsToUpdate) {
            const channel = await this.findBotChannel(guild, type);
            if (channel) {
                await this.updateOrSendMessage(
                    channel,
                    m => m.author.id === this.client.user.id && m.embeds[0]?.title === embedTitle,
                    { embeds: [embed], files: [attachment] }
                );
            }
        }
    }

    async updateSummaryChannel(filter, singleGuild = null) {
        if (!this.client || !this.isBotReady) return;

        let allProxies = [], embedTitle, fileName, channelName;
        const proxySet = new Set();

        if (filter === 'all') {
            embedTitle = '🌐 All Available Proxies';
            fileName = 'all-proxies.txt';
            channelName = 'all-proxies';
            this.filters.forEach(f => {
                this.validTypes.forEach(t => {
                    this.proxyCache[f][t].data.forEach(p => proxySet.add(p));
                });
            });
        } else {
            embedTitle = `🔗 All ${filter} Proxies`;
            fileName = `all-proxies-${filter}.txt`;
            channelName = `all-proxies-${filter}`;
            this.validTypes.forEach(t => {
                if (this.proxyCache[filter]?.[t]?.data) {
                    this.proxyCache[filter][t].data.forEach(p => proxySet.add(p));
                }
            });
        }
        allProxies = [...proxySet];

        const embed = new EmbedBuilder()
            .setColor(allProxies.length > 0 ? 0x5865F2 : 0xFF0000)
            .setTitle(embedTitle)
            .setDescription(`Found a total of **${allProxies.length}** unique links across all types. See attached file for the full list.`)
            .setFooter({ text: 'Last Updated' })
            .setTimestamp();
        
        const fileContent = allProxies.length > 0 ? allProxies.join('\n') : "No links found.";
        const attachment = new AttachmentBuilder(
            Buffer.from(fileContent, 'utf-8'), 
            { name: fileName }
        );
        
        const guildsToUpdate = singleGuild ? [singleGuild] : this.client.guilds.cache.values();
        for (const guild of guildsToUpdate) {
            const channel = await this.findBotChannel(guild, channelName);
            if (channel) {
                await this.updateOrSendMessage(
                    channel,
                    m => m.author.id === this.client.user.id,
                    { embeds: [embed], files: [attachment] }
                );
            }
        }
    }

    async setupGuildChannels(guild) {
        if (!this.client) return;

        console.log(`[${guild.name}] Running channel setup...`);
        
        const verifiedRole = guild.roles.cache.find(role => role.name === this.config.verifiedRoleName);
        if (!verifiedRole && this.config.verifiedRoleName) {
            console.warn(`[${guild.name}] Verified role "${this.config.verifiedRoleName}" not found. Channels will be created but hidden.`);
        }

        // 1. Ensure category exists
        let category = guild.channels.cache.find(c => c.name === this.CATEGORY_NAME && c.type === ChannelType.GuildCategory);
        if (!category) {
            console.log(`[${guild.name}] Creating category "${this.CATEGORY_NAME}"`);
            try {
                const permissionOverwrites = [{ 
                    id: guild.roles.everyone.id, 
                    deny: [PermissionsBitField.Flags.ViewChannel] 
                }];
                if (verifiedRole) {
                    permissionOverwrites.push({ 
                        id: verifiedRole.id, 
                        allow: [PermissionsBitField.Flags.ViewChannel] 
                    });
                }
                category = await guild.channels.create({ 
                    name: this.CATEGORY_NAME, 
                    type: ChannelType.GuildCategory, 
                    permissionOverwrites 
                });
                console.log(`[${guild.name}] Successfully created category.`);
            } catch (e) {
                console.error(`[${guild.name}] Could not create category. Check permissions.`, e);
                return;
            }
        }

        // 2. Define all channels to be created
        const channelsToCreate = [...this.validTypes, 'all-proxies-lightspeed', 'all-proxies-securly', 'all-proxies'];

        // 3. Create channels with rate limiting
        for (const channelName of channelsToCreate) {
            await this.createOrMoveChannel(guild, channelName, category, verifiedRole);
            await new Promise(resolve => setTimeout(resolve, 500)); // Rate limit protection
        }

        console.log(`[${guild.name}] Channel setup finished.`);
    }

    async populateNewGuildChannels(guild) {
        if (!this.client || !this.isBotReady) return;

        console.log(`Populating channels with cached data for guild: ${guild.name}`);
        for (const type of this.validTypes) {
            for (const filter of this.filters) {
                await this.updateProxyTypeChannel(type, filter, guild);
            }
        }
        await this.updateSummaryChannel('lightspeed', guild);
        await this.updateSummaryChannel('securly', guild);
        await this.updateSummaryChannel('all', guild);
    }

    async findBotChannel(guild, channelName) {
        const category = guild.channels.cache.find(c => c.name === this.CATEGORY_NAME && c.type === ChannelType.GuildCategory);
        if (!category) return null;
        return guild.channels.cache.find(c => c.name === channelName && c.parentId === category.id);
    }

    async createOrMoveChannel(guild, name, category, verifiedRole) {
        // Check if channel already exists in the correct place
        if (guild.channels.cache.some(c => c.name === name && c.parentId === category.id)) {
            return;
        }
        
        // Check if channel exists elsewhere and move it
        const channelElsewhere = guild.channels.cache.find(c => c.name === name && c.type === ChannelType.GuildText);
        if (channelElsewhere) {
            console.log(`[${guild.name}] Moving existing channel "#${name}" into category.`);
            try {
                await channelElsewhere.setParent(category, { lockPermissions: false });
                return;
            } catch (e) {
                console.error(`[${guild.name}] Could not move channel ${name}.`, e);
            }
        }
        
        // Create the channel from scratch
        console.log(`[${guild.name}] Creating new channel "#${name}".`);
        try {
            const permissionOverwrites = [{
                id: guild.roles.everyone.id,
                deny: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
            }];
            if (verifiedRole) {
                permissionOverwrites.push({
                    id: verifiedRole.id,
                    allow: [PermissionsBitField.Flags.ViewChannel],
                    deny: [PermissionsBitField.Flags.SendMessages],
                });
            }
            await guild.channels.create({ 
                name, 
                type: ChannelType.GuildText, 
                parent: category, 
                permissionOverwrites 
            });
        } catch (e) {
            console.error(`[${guild.name}] Could not create channel ${name}.`, e);
        }
    }

    async updateOrSendMessage(channel, findCondition, messagePayload) {
        try {
            const messages = await channel.messages.fetch({ limit: 20 });
            const botMessage = messages.find(findCondition);
            if (botMessage) {
                await botMessage.edit(messagePayload);
            } else {
                await channel.send(messagePayload);
            }
        } catch (error) {
            // Silently ignore permission/access errors
            if (error.code !== 50001 && error.code !== 10003) {
                console.error(`Failed to update message in channel #${channel.name}:`, error);
            }
        }
    }
}

// Export both the class and a factory function
export default {
    ProxyBotAPI,
    
    // Factory function for easy setup
    createProxyBot: (options) => new ProxyBotAPI(options),
    
    // Utility functions that can be used independently
    utils: {
        validateProxyType: (type, validTypes) => validTypes.includes(type),
        validateFilter: (filter, validFilters) => validFilters.includes(filter),
        formatProxyList: (proxies) => proxies.join('\n'),
        chunksArray: (array, size) => {
            const chunks = [];
            for (let i = 0; i < array.length; i += size) {
                chunks.push(array.slice(i, i + size));
            }
            return chunks;
        }
    }
};