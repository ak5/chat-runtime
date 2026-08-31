import { Bot, InlineKeyboard } from "grammy";
import { PROTOCOL_VERSION, newProtocolId, type RuntimeAction, type RuntimeEvent } from "@chat-runtime/protocol";
import type { RuntimeConfig } from "./config.js";
import type { ExecutionResult, PlatformAdapter } from "./platform.js";
import { telegramText } from "./render.js";

export class TelegramAdapter implements PlatformAdapter {
  readonly platform = "telegram" as const;
  private readonly bot: Bot;
  private ready = false;
  private identityId?: string;
  private readonly interactions = new Map<string, { conversationId: string; callback: boolean }>();

  constructor(private readonly config: RuntimeConfig) { this.bot = new Bot(config.TELEGRAM_TOKEN!); }

  async start(onEvent: (event: RuntimeEvent) => Promise<void>): Promise<{ identityId: string }> {
    const identity = await this.bot.api.getMe();
    this.identityId = String(identity.id);
    this.bot.on("message", async (ctx) => {
      if (String(ctx.from.id) === this.identityId || !this.chatAllowed(String(ctx.chat.id))) return;
      const message = ctx.message;
      const command = message.text?.match(/^\/([a-z0-9_]+)(?:@[a-z0-9_]+)?(?:\s+([\s\S]*))?$/i);
      if (command) {
        const interactionId = `telegram-command:${ctx.chat.id}:${message.message_id}`;
        this.rememberInteraction(interactionId, { conversationId: String(ctx.chat.id), callback: false });
        await onEvent({
          protocolVersion: PROTOCOL_VERSION, eventId: newProtocolId("evt"), installationId: this.config.CHAT_RUNTIME_INSTALLATION_ID,
          platform: "telegram", botIdentityId: this.identityId, occurredAt: new Date(message.date * 1000).toISOString(), type: "interaction.command", metadata: { updateId: ctx.update.update_id },
          payload: { interactionId, conversationId: String(ctx.chat.id), userId: String(ctx.from.id), name: command[1]!.toLowerCase(), arguments: command[2] ? { text: command[2] } : {} },
        });
        return;
      }
      await onEvent({
        protocolVersion: PROTOCOL_VERSION, eventId: newProtocolId("evt"), installationId: this.config.CHAT_RUNTIME_INSTALLATION_ID,
        platform: "telegram", botIdentityId: this.identityId, occurredAt: new Date(message.date * 1000).toISOString(), type: "message.created", metadata: { updateId: ctx.update.update_id },
        payload: { messageId: String(message.message_id), conversationId: String(ctx.chat.id), authorId: String(ctx.from.id), authorDisplayName: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" "), text: message.text ?? message.caption, replyToMessageId: message.reply_to_message ? String(message.reply_to_message.message_id) : undefined, threadId: message.message_thread_id ? String(message.message_thread_id) : undefined, attachments: [], isFromRuntime: false },
      });
    });
    this.bot.on("callback_query:data", async (ctx) => {
      const conversationId = String(ctx.chat?.id ?? "");
      if (!conversationId || !this.chatAllowed(conversationId)) return;
      this.rememberInteraction(ctx.callbackQuery.id, { conversationId, callback: true });
      await onEvent({
        protocolVersion: PROTOCOL_VERSION, eventId: newProtocolId("evt"), installationId: this.config.CHAT_RUNTIME_INSTALLATION_ID,
        platform: "telegram", botIdentityId: this.identityId, occurredAt: new Date().toISOString(), type: "interaction.component", metadata: { updateId: ctx.update.update_id },
        payload: { interactionId: ctx.callbackQuery.id, conversationId, userId: String(ctx.from.id), customId: ctx.callbackQuery.data, values: [] },
      });
    });
    this.bot.catch((error) => console.error(JSON.stringify({ level: "error", event: "telegram_update_failed", error: String(error.error) })));
    this.ready = true;
    void this.bot.start({ allowed_updates: ["message", "callback_query"] }).finally(() => { this.ready = false; });
    return { identityId: this.identityId };
  }

  async execute(action: RuntimeAction): Promise<ExecutionResult> {
    if (action.platform !== "telegram") throw new Error("Telegram adapter received a non-Telegram action");
    switch (action.type) {
      case "interaction.acknowledge": case "interaction.defer": {
        const interaction = this.interactions.get(action.interactionId);
        if (!interaction) throw new Error("Telegram interaction is no longer available");
        if (interaction.callback) await this.bot.api.answerCallbackQuery(action.interactionId);
        if (action.type === "interaction.acknowledge" && action.content) {
          const sent = await this.bot.api.sendMessage(interaction.conversationId, telegramText(action.content), { link_preview_options: { is_disabled: true } });
          return { externalId: String(sent.message_id) };
        }
        return {};
      }
      case "interaction.open-modal": case "member.role.add": case "member.role.remove": throw new Error(`${action.type} is unsupported on Telegram`);
      case "message.send": case "message.reply": {
        if (!this.chatAllowed(action.conversationId)) throw new Error("Telegram chat is not allowlisted");
        const buttons = action.content.components.filter((item) => item.type === "button");
        const keyboard = buttons.length ? new InlineKeyboard() : undefined;
        for (const button of buttons) {
          if (button.url) keyboard!.url(button.label, button.url);
          else keyboard!.text(button.label, button.customId!);
        }
        const sent = await this.bot.api.sendMessage(action.conversationId, telegramText(action.content), { ...(action.type === "message.reply" ? { reply_parameters: { message_id: Number(action.messageId) } } : {}), ...(keyboard ? { reply_markup: keyboard } : {}), link_preview_options: { is_disabled: true } });
        return { externalId: String(sent.message_id) };
      }
      case "message.edit": if (!this.chatAllowed(action.conversationId)) throw new Error("Telegram chat is not allowlisted"); await this.bot.api.editMessageText(action.conversationId, Number(action.messageId), telegramText(action.content)); return { externalId: action.messageId };
      case "message.delete": if (!this.chatAllowed(action.conversationId)) throw new Error("Telegram chat is not allowlisted"); await this.bot.api.deleteMessage(action.conversationId, Number(action.messageId)); return {};
      case "reaction.add": case "reaction.remove":
        if (!this.chatAllowed(action.conversationId)) throw new Error("Telegram chat is not allowlisted");
        await this.bot.api.setMessageReaction(action.conversationId, Number(action.messageId), action.type === "reaction.add" ? [{ type: "emoji", emoji: action.emoji as "👍" }] : []); return {};
    }
  }

  async stop(): Promise<void> { if (this.ready) await this.bot.stop(); this.ready = false; }
  isReady(): boolean { return this.ready; }
  private chatAllowed(chatId: string): boolean { return this.config.TELEGRAM_ALLOWED_CHAT_IDS.length === 0 || this.config.TELEGRAM_ALLOWED_CHAT_IDS.includes(chatId); }
  private rememberInteraction(id: string, value: { conversationId: string; callback: boolean }): void {
    this.interactions.set(id, value);
    setTimeout(() => this.interactions.delete(id), 15 * 60_000).unref();
  }
}
