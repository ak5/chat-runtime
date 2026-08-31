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
