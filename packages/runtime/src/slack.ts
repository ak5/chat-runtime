import { App, LogLevel, type RespondFn } from "@slack/bolt";
import { PROTOCOL_VERSION, newProtocolId, type RuntimeAction, type RuntimeEvent } from "@chat-runtime/protocol";
import type { RuntimeConfig } from "./config.js";
import type { ExecutionResult, PlatformAdapter } from "./platform.js";
import { slackMessage, slackModal } from "./render.js";

type Interaction = { respond?: RespondFn; triggerId?: string };

export class SlackAdapter implements PlatformAdapter {
  readonly platform = "slack" as const;
  private readonly app: App;
  private readonly interactions = new Map<string, Interaction>();
  private ready = false;
  private identityId?: string;

  constructor(private readonly config: RuntimeConfig) {
    this.app = new App({ token: config.SLACK_BOT_TOKEN!, appToken: config.SLACK_APP_TOKEN!, socketMode: true, logLevel: LogLevel.WARN });
  }

  async start(onEvent: (event: RuntimeEvent) => Promise<void>): Promise<{ identityId: string }> {
    const auth = await this.app.client.auth.test();
    if (!auth.user_id) throw new Error("Slack authentication did not return a bot user ID");
    this.identityId = auth.user_id;

    this.app.event("message", async ({ event, body }) => {
      const message = event as Record<string, any>;
      const channel = String(message.channel ?? "");
      if (!channel || !this.channelAllowed(channel)) return;
      if (message.subtype === "message_deleted") {
        await this.emit(onEvent, "message.deleted", { messageId: String(message.deleted_ts), conversationId: channel }, String((body as { event_id?: string }).event_id ?? ""));
        return;
      }
      const source = message.subtype === "message_changed" ? message.message as Record<string, any> : message;
      if (!source?.ts || (!source.user && !source.bot_id)) return;
      await this.emit(onEvent, message.subtype === "message_changed" ? "message.updated" : "message.created", {
        messageId: String(source.ts), conversationId: channel, authorId: String(source.user ?? source.bot_id), text: source.text || undefined,
        replyToMessageId: source.thread_ts && source.thread_ts !== source.ts ? String(source.thread_ts) : undefined,
        threadId: source.thread_ts ? String(source.thread_ts) : undefined,
        attachments: Array.isArray(source.files) ? source.files.flatMap((file: Record<string, any>) => file.id && file.url_private ? [{ id: String(file.id), url: String(file.url_private), filename: String(file.name ?? file.title ?? file.id), contentType: file.mimetype ? String(file.mimetype) : undefined, size: typeof file.size === "number" ? file.size : undefined }] : []) : [],
        isFromRuntime: source.user === this.identityId,
      }, String((body as { event_id?: string }).event_id ?? ""));
    });

    for (const eventType of ["reaction_added", "reaction_removed"] as const) this.app.event(eventType, async ({ event, body }) => {
      if (event.item.type !== "message" || !this.channelAllowed(event.item.channel) || event.user === this.identityId) return;
      await this.emit(onEvent, eventType === "reaction_added" ? "reaction.added" : "reaction.removed", { messageId: event.item.ts, conversationId: event.item.channel, userId: event.user, emoji: event.reaction }, String((body as { event_id?: string }).event_id ?? ""));
    });

    this.app.command(/.*/, async ({ command, ack, respond }) => {
      await ack();
      if (!this.channelAllowed(command.channel_id)) return;
      const interactionId = `slack-command:${command.trigger_id}`;
      this.rememberInteraction(interactionId, { respond, triggerId: command.trigger_id });
      await this.emit(onEvent, "interaction.command", { interactionId, conversationId: command.channel_id, userId: command.user_id, name: command.command.replace(/^\//, ""), arguments: command.text ? { text: command.text } : {}, token: command.trigger_id });
    });

    this.app.action(/.*/, async ({ body, action, ack, respond }) => {
      await ack();
      if (!("channel" in body) || !body.channel || !("trigger_id" in body) || !body.trigger_id || !this.channelAllowed(body.channel.id)) return;
      const actionData = action as { action_id: string; selected_option?: { value: string }; selected_options?: Array<{ value: string }> };
      const interactionId = `slack-action:${body.trigger_id}`;
      this.rememberInteraction(interactionId, { respond, triggerId: body.trigger_id });
      const values = actionData.selected_options?.map((option) => option.value) ?? (actionData.selected_option ? [actionData.selected_option.value] : []);
      await this.emit(onEvent, "interaction.component", { interactionId, conversationId: body.channel.id, userId: body.user.id, customId: actionData.action_id, values, token: body.trigger_id });
    });

    this.app.view(/.*/, async ({ body, view, ack }) => {
      await ack();
      const fields = Object.fromEntries(Object.entries(view.state.values).flatMap(([blockId, actions]) => Object.values(actions).map((input) => [blockId, "value" in input ? input.value ?? "" : "selected_option" in input ? input.selected_option?.value ?? "" : ""])));
      await this.emit(onEvent, "interaction.modal", { interactionId: `slack-view:${view.id}`, conversationId: body.user.id, userId: body.user.id, customId: view.callback_id, fields });
    });

    await this.app.start();
    this.ready = true;
    return { identityId: this.identityId };
  }

  async execute(action: RuntimeAction): Promise<ExecutionResult> {
    if (action.platform !== "slack") throw new Error("Slack adapter received a non-Slack action");
    switch (action.type) {
      case "interaction.acknowledge": {
        const interaction = this.interactions.get(action.interactionId);
        if (!interaction) throw new Error("Slack interaction is no longer available");
        if (action.content && interaction.respond) await interaction.respond({ ...slackMessage(action.content), response_type: action.ephemeral ? "ephemeral" : "in_channel" });
        return {};
      }
      case "interaction.defer": return {};
      case "interaction.open-modal": {
        const interaction = this.interactions.get(action.interactionId);
        if (!interaction?.triggerId) throw new Error("Slack interaction is no longer available");
        const result = await this.app.client.views.open({ trigger_id: interaction.triggerId, view: slackModal(action.modal) });
        return result.view?.id ? { externalId: result.view.id } : {};
      }
      case "message.send": case "message.reply": {
        this.assertChannelAllowed(action.conversationId);
        const result = await this.app.client.chat.postMessage({ channel: action.conversationId, ...slackMessage(action.content), ...(action.type === "message.reply" ? { thread_ts: action.messageId } : {}), unfurl_links: false, unfurl_media: false });
        return result.ts ? { externalId: result.ts } : {};
      }
      case "message.edit": {
        this.assertChannelAllowed(action.conversationId);
        const result = await this.app.client.chat.update({ channel: action.conversationId, ts: action.messageId, ...slackMessage(action.content) });
        return result.ts ? { externalId: result.ts } : {};
      }
      case "message.delete": this.assertChannelAllowed(action.conversationId); await this.app.client.chat.delete({ channel: action.conversationId, ts: action.messageId }); return {};
      case "reaction.add": case "reaction.remove": {
        this.assertChannelAllowed(action.conversationId);
        const method = action.type === "reaction.add" ? this.app.client.reactions.add.bind(this.app.client.reactions) : this.app.client.reactions.remove.bind(this.app.client.reactions);
        await method({ channel: action.conversationId, timestamp: action.messageId, name: action.emoji.replace(/^:|:$/g, "") }); return {};
      }
      case "member.role.add": case "member.role.remove": throw new Error(`${action.type} is unsupported on Slack`);
    }
  }

  async stop(): Promise<void> { if (this.ready) await this.app.stop(); this.ready = false; }
  isReady(): boolean { return this.ready; }
  private channelAllowed(channelId: string): boolean { return this.config.SLACK_ALLOWED_CHANNEL_IDS.length === 0 || this.config.SLACK_ALLOWED_CHANNEL_IDS.includes(channelId); }
  private assertChannelAllowed(channelId: string): void { if (!this.channelAllowed(channelId)) throw new Error("Slack channel is not allowlisted"); }
  private rememberInteraction(id: string, interaction: Interaction): void { this.interactions.set(id, interaction); setTimeout(() => this.interactions.delete(id), 15 * 60_000).unref(); }
  private async emit(onEvent: (event: RuntimeEvent) => Promise<void>, type: RuntimeEvent["type"], payload: any, eventId?: string): Promise<void> {
    await onEvent({ protocolVersion: PROTOCOL_VERSION, eventId: eventId || newProtocolId("evt"), installationId: this.config.CHAT_RUNTIME_INSTALLATION_ID, platform: "slack", botIdentityId: this.identityId, occurredAt: new Date().toISOString(), type, payload, metadata: {} } as RuntimeEvent);
  }
}
