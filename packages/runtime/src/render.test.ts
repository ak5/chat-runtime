import { describe, expect, it } from "vitest";
import type { RuntimeAction } from "@chat-runtime/protocol";
import { discordMessage, telegramText } from "./render.js";

const content = (text: string): Extract<RuntimeAction, { type: "message.send" }>["content"] => ({ text, fields: [], images: [], components: [], suppressNotifications: true });

describe("platform rendering limits", () => {
  it("bounds Discord and Telegram text", () => {
    expect(discordMessage(content("x".repeat(3000))).content).toHaveLength(2000);
    expect(telegramText(content("x".repeat(5000)))).toHaveLength(4096);
  });

  it("rejects Telegram select controls rather than silently degrading", () => {
    expect(() => telegramText({ ...content("choose"), components: [{ type: "select", customId: "choice", minValues: 1, maxValues: 1, choices: [{ label: "One", value: "1" }] }] })).toThrow(/does not support select/);
  });
});
