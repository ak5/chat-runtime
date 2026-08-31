import { ActionRowBuilder, Client, GatewayIntentBits, ModalBuilder, TextInputBuilder, TextInputStyle, type ChatInputCommandInteraction, type GuildMember, type Interaction, type Message, type MessageReaction, type PartialMessageReaction, type PartialUser, type User } from "discord.js";
import { PROTOCOL_VERSION, newProtocolId, type RuntimeAction, type RuntimeEvent } from "@chat-runtime/protocol";
import type { RuntimeConfig } from "./config.js";
import type { ExecutionResult, PlatformAdapter } from "./platform.js";
import { discordEditMessage, discordInteractionMessage, discordMessage } from "./render.js";

const intentByName: Record<string, GatewayIntentBits> = {
  Guilds: GatewayIntentBits.Guilds, GuildMembers: GatewayIntentBits.GuildMembers,
  GuildMessages: GatewayIntentBits.GuildMessages, GuildMessageReactions: GatewayIntentBits.GuildMessageReactions,
  DirectMessages: GatewayIntentBits.DirectMessages, MessageContent: GatewayIntentBits.MessageContent,
  GuildModeration: GatewayIntentBits.GuildModeration, GuildPresences: GatewayIntentBits.GuildPresences,
};

export class DiscordAdapter implements PlatformAdapter {
  readonly platform = "discord" as const;
  private readonly client: Client;
  private readonly interactions = new Map<string, Interaction>();
  private onEvent?: (event: RuntimeEvent) => Promise<void>;

  constructor(private readonly config: RuntimeConfig) {
    const intents = config.DISCORD_INTENTS.map((name) => intentByName[name]).filter((value): value is GatewayIntentBits => value !== undefined);
    this.client = new Client({ intents, partials: [] });
  }

  async start(onEvent: (event: RuntimeEvent) => Promise<void>): Promise<{ identityId: string }> {
    this.onEvent = onEvent;
    this.client.on("messageCreate", (message) => void this.handleMessage("message.created", message));
    this.client.on("messageUpdate", (_, message) => { if (!message.partial) void this.handleMessage("message.updated", message); });
    this.client.on("messageDelete", (message) => void this.emit("message.deleted", { messageId: message.id, conversationId: message.channelId }));
    this.client.on("interactionCreate", (interaction) => void this.handleInteraction(interaction));
    this.client.on("messageReactionAdd", (reaction, user) => void this.handleReaction("reaction.added", reaction, user));
    this.client.on("messageReactionRemove", (reaction, user) => void this.handleReaction("reaction.removed", reaction, user));
    this.client.on("guildMemberAdd", (member) => void this.handleMember("member.joined", member));
    this.client.on("guildMemberUpdate", (_, member) => void this.handleMember("member.updated", member));
    await this.client.login(this.config.DISCORD_TOKEN!);
    await new Promise<void>((resolve) => this.client.isReady() ? resolve() : this.client.once("ready", () => resolve()));
    return { identityId: this.client.user!.id };
  }

  async execute(action: RuntimeAction): Promise<ExecutionResult> {
    if (action.platform !== "discord") throw new Error("Discord adapter received a non-Discord action");
    switch (action.type) {
      case "interaction.acknowledge": case "interaction.defer": case "interaction.open-modal": return this.executeInteraction(action);
      case "member.role.add": case "member.role.remove": {
        const guild = await this.client.guilds.fetch(action.guildId);
        const member = await guild.members.fetch(action.userId);
        if (action.type === "member.role.add") await member.roles.add(action.roleId); else await member.roles.remove(action.roleId);
        return {};
      }
      case "message.send": {
        const channel = await this.client.channels.fetch(action.conversationId);
        if (!channel?.isSendable()) throw new Error("Discord conversation cannot send messages");
        return { externalId: (await channel.send(discordMessage(action.content))).id };
      }
      case "message.reply": case "message.edit": case "message.delete": case "reaction.add": case "reaction.remove": {
        const channel = await this.client.channels.fetch(action.conversationId);
        if (!channel?.isTextBased() || !("messages" in channel)) throw new Error("Discord conversation does not expose messages");
        const message = await channel.messages.fetch(action.messageId);
        if (action.type === "message.reply") return { externalId: (await message.reply(discordMessage(action.content))).id };
        if (action.type === "message.edit") { await message.edit(discordEditMessage(action.content)); return { externalId: message.id }; }
        if (action.type === "message.delete") { await message.delete(); return {}; }
        if (action.type === "reaction.add") { await message.react(action.emoji); return {}; }
        await message.reactions.resolve(action.emoji)?.users.remove(this.client.user!.id); return {};
      }
    }
  }

  async stop(): Promise<void> { this.client.destroy(); }
  isReady(): boolean { return this.client.isReady(); }

  private async executeInteraction(action: Extract<RuntimeAction, { type: `interaction.${string}` }>): Promise<ExecutionResult> {
    const interaction = this.interactions.get(action.interactionId);
    if (!interaction) throw new Error("Interaction is no longer available");
    if (action.type === "interaction.open-modal") {
      if (!("showModal" in interaction)) throw new Error("Interaction cannot open a modal");
      const modal = new ModalBuilder().setCustomId(action.modal.customId).setTitle(action.modal.title);
      modal.addComponents(action.modal.fields.map((field) => {
        const input = new TextInputBuilder().setCustomId(field.customId).setLabel(field.label).setStyle(field.style === "paragraph" ? TextInputStyle.Paragraph : TextInputStyle.Short).setRequired(field.required);
        if (field.minLength !== undefined) input.setMinLength(field.minLength);
        if (field.maxLength !== undefined) input.setMaxLength(field.maxLength);
        if (field.placeholder) input.setPlaceholder(field.placeholder);
        return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
      }));
      await interaction.showModal(modal); return {};
    }
    if (!interaction.isRepliable()) throw new Error("Interaction cannot be acknowledged");
    if (action.type === "interaction.defer") { await interaction.deferReply({ ephemeral: action.ephemeral }); return {}; }
    await interaction.reply({ ...(action.content ? discordInteractionMessage(action.content) : { content: "Acknowledged" }), ephemeral: action.ephemeral });
    return {};
  }

  private async handleMessage(type: "message.created" | "message.updated", message: Message): Promise<void> {
    if (message.author.id === this.client.user?.id || !this.guildAllowed(message.guildId)) return;
    await this.emit(type, {
      messageId: message.id, conversationId: message.channelId, authorId: message.author.id,
      authorDisplayName: message.member?.displayName ?? message.author.displayName, text: message.content || undefined,
      replyToMessageId: message.reference?.messageId, threadId: message.channel.isThread() ? message.channel.id : undefined,
      attachments: message.attachments.map((item) => ({ id: item.id, url: item.url, filename: item.name, contentType: item.contentType ?? undefined, size: item.size, width: item.width ?? undefined, height: item.height ?? undefined })),
      isFromRuntime: false,
    });
  }

  private async handleInteraction(interaction: Interaction): Promise<void> {
    if (!this.guildAllowed(interaction.guildId)) return;
    this.interactions.set(interaction.id, interaction);
    setTimeout(() => this.interactions.delete(interaction.id), 15 * 60_000).unref();
    if (interaction.isChatInputCommand()) {
      await this.emit("interaction.command", { interactionId: interaction.id, conversationId: interaction.channelId ?? interaction.user.id, userId: interaction.user.id, name: interaction.commandName, arguments: commandArguments(interaction), token: interaction.token });
    } else if (interaction.isButton() || interaction.isStringSelectMenu()) {
      await this.emit("interaction.component", { interactionId: interaction.id, conversationId: interaction.channelId ?? interaction.user.id, userId: interaction.user.id, customId: interaction.customId, values: interaction.isStringSelectMenu() ? interaction.values : [], token: interaction.token });
    } else if (interaction.isModalSubmit()) {
      await this.emit("interaction.modal", { interactionId: interaction.id, conversationId: interaction.channelId ?? interaction.user.id, userId: interaction.user.id, customId: interaction.customId, fields: Object.fromEntries(interaction.fields.fields.map((field) => [field.customId, interaction.fields.getTextInputValue(field.customId)])), token: interaction.token });
    }
  }

  private async handleReaction(type: "reaction.added" | "reaction.removed", reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser): Promise<void> {
    if (user.id === this.client.user?.id || !this.guildAllowed(reaction.message.guildId)) return;
    await this.emit(type, { messageId: reaction.message.id, conversationId: reaction.message.channelId, userId: user.id, emoji: reaction.emoji.id ?? reaction.emoji.name ?? "unknown" });
  }

  private async handleMember(type: "member.joined" | "member.updated", member: GuildMember): Promise<void> {
    if (!this.guildAllowed(member.guild.id)) return;
    await this.emit(type, { guildId: member.guild.id, userId: member.id, displayName: member.displayName, ...(type === "member.updated" ? { roleIds: [...member.roles.cache.keys()] } : {}) });
  }

  private guildAllowed(guildId: string | null): boolean { return guildId === null || this.config.DISCORD_GUILD_IDS.length === 0 || this.config.DISCORD_GUILD_IDS.includes(guildId); }
  private async emit(type: RuntimeEvent["type"], payload: any): Promise<void> {
    await this.onEvent?.({ protocolVersion: PROTOCOL_VERSION, eventId: newProtocolId("evt"), installationId: this.config.CHAT_RUNTIME_INSTALLATION_ID, platform: "discord", botIdentityId: this.client.user?.id, occurredAt: new Date().toISOString(), type, payload, metadata: {} } as RuntimeEvent);
  }
}

function commandArguments(interaction: ChatInputCommandInteraction): Record<string, string | number | boolean> {
  return Object.fromEntries(interaction.options.data.map((option) => [option.name, option.value ?? option.options?.map((nested) => nested.value).filter(Boolean).join(",") ?? ""]));
}
