import { describe, expect, it } from "vitest";
import type { RuntimeAction } from "@chat-runtime/protocol";
import { discordMessage, slackMessage, slackModal, telegramText } from "./render.js";

const content = (text: string): Extract<RuntimeAction, { type: "message.send" }>["content"] => ({ text, fields: [], images: [], components: [], suppressNotifications: true });

describe("platform rendering limits", () => {
  it("bounds Discord and Telegram text", () => {
    expect(discordMessage(content("x".repeat(3000))).content).toHaveLength(2000);
    expect(telegramText(content("x".repeat(5000)))).toHaveLength(4096);
  });

  it("rejects Telegram select controls rather than silently degrading", () => {
    expect(() => telegramText({ ...content("choose"), components: [{ type: "select", customId: "choice", minValues: 1, maxValues: 1, choices: [{ label: "One", value: "1" }] }] })).toThrow(/does not support select/);
  });

  it("renders Slack blocks and accessible fallback text", () => {
    const rendered = slackMessage({ ...content("hello"), fields: [{ name: "Status", value: "Ready", inline: false }], components: [{ type: "button", customId: "go", label: "Go", style: "primary" }] });
    expect(rendered.text).toContain("Status: Ready");
    expect(rendered.blocks.map((block) => block.type)).toEqual(["section", "section", "actions"]);
  });

  it("renders Slack modal fields", () => {
    const modal = slackModal({ title: "Form", customId: "form", fields: [{ customId: "answer", label: "Answer", style: "paragraph", required: true }] });
    expect(modal.callback_id).toBe("form");
    expect(modal.blocks).toHaveLength(1);
  });
});
