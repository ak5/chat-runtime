import type { RuntimeAction } from "@chat-runtime/protocol";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, StringSelectMenuBuilder, type InteractionReplyOptions, type MessageCreateOptions, type MessageEditOptions } from "discord.js";

type ContentAction = Extract<RuntimeAction, { content: unknown }>;

function discordContent(content: ContentAction["content"]) {
  const embeds = content.fields.length || content.images.length ? [new EmbedBuilder()
    .setFields(content.fields.map((field) => ({ name: field.name, value: field.value, inline: field.inline })))
    .setImage(content.images[0]?.url ?? null)] : [];
  const rows = content.components.map((component) => {
    if (component.type === "button") {
      const style = component.url ? ButtonStyle.Link : ({ primary: ButtonStyle.Primary, secondary: ButtonStyle.Secondary, success: ButtonStyle.Success, danger: ButtonStyle.Danger, link: ButtonStyle.Link } as const)[component.style];
      const button = new ButtonBuilder().setLabel(component.label).setStyle(style);
      if (component.url) button.setURL(component.url); else button.setCustomId(component.customId!);
      return new ActionRowBuilder<ButtonBuilder>().addComponents(button);
    }
    const choices = component.choices.map((choice) => ({ label: choice.label, value: choice.value, ...(choice.description ? { description: choice.description } : {}) }));
    const select = new StringSelectMenuBuilder().setCustomId(component.customId).setMinValues(component.minValues).setMaxValues(component.maxValues).addOptions(choices);
    if (component.placeholder) select.setPlaceholder(component.placeholder);
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
  });
  return { ...(content.text ? { content: content.text.slice(0, 2000) } : {}), embeds, components: rows, allowedMentions: { parse: [] as never[] } };
}

export function discordMessage(content: ContentAction["content"]): MessageCreateOptions {
  return { ...discordContent(content), ...(content.suppressNotifications ? { flags: MessageFlags.SuppressNotifications } : {}) };
}

export function discordInteractionMessage(content: ContentAction["content"]): InteractionReplyOptions {
  return { ...discordContent(content), ...(content.suppressNotifications ? { flags: MessageFlags.SuppressNotifications } : {}) };
}

export function discordEditMessage(content: ContentAction["content"]): MessageEditOptions {
  return discordContent(content);
}

export function telegramText(content: ContentAction["content"]): string {
  if (content.components.some((component) => component.type === "select")) throw new Error("Telegram does not support select components");
  const sections = [content.text, ...content.fields.map((field) => `${field.name}\n${field.value}`), ...content.images.map((image) => image.url)].filter(Boolean);
  const rendered = sections.join("\n\n");
  if (!rendered) throw new Error("Telegram message content rendered empty");
  return rendered.slice(0, 4096);
}

export function slackMessage(content: ContentAction["content"]) {
  const fallback = [content.text, ...content.fields.map((field) => `${field.name}: ${field.value}`), ...content.images.map((image) => image.alt ?? image.url)].filter(Boolean).join("\n\n").slice(0, 40_000) || "Message";
  const blocks: Array<Record<string, unknown>> = [];
  if (content.text) blocks.push({ type: "section", text: { type: "mrkdwn", text: content.text.slice(0, 3000) } });
  for (const field of content.fields) blocks.push({ type: "section", text: { type: "mrkdwn", text: `*${field.name}*\n${field.value}`.slice(0, 3000) } });
  for (const image of content.images) blocks.push({ type: "image", image_url: image.url, alt_text: image.alt ?? "Image" });
  for (const component of content.components) {
    if (component.type === "button") {
      blocks.push({ type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: component.label }, ...(component.url ? { url: component.url, action_id: `link-${component.label}`.slice(0, 255) } : { action_id: component.customId! }), value: component.customId ?? component.url! }] });
    } else {
      blocks.push({ type: "actions", elements: [{ type: "static_select", action_id: component.customId, ...(component.placeholder ? { placeholder: { type: "plain_text", text: component.placeholder } } : {}), options: component.choices.map((choice) => ({ text: { type: "plain_text", text: choice.label }, value: choice.value, ...(choice.description ? { description: { type: "plain_text", text: choice.description } } : {}) })) }] });
    }
  }
  return { text: fallback, blocks: blocks.slice(0, 50) };
}

export function slackModal(modal: Extract<RuntimeAction, { type: "interaction.open-modal" }>["modal"]) {
  return {
    type: "modal" as const, callback_id: modal.customId, title: { type: "plain_text" as const, text: modal.title }, submit: { type: "plain_text" as const, text: "Submit" },
    blocks: modal.fields.map((field) => ({
      type: "input" as const, block_id: field.customId, optional: !field.required, label: { type: "plain_text" as const, text: field.label },
      element: { type: "plain_text_input" as const, action_id: field.customId, multiline: field.style === "paragraph", ...(field.minLength !== undefined ? { min_length: field.minLength } : {}), ...(field.maxLength !== undefined ? { max_length: field.maxLength } : {}), ...(field.placeholder ? { placeholder: { type: "plain_text" as const, text: field.placeholder } } : {}) },
    })),
  };
}
