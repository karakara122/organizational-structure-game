import { describe, expect, it } from "vitest";
import { GAME_TITLE, SAVE_KEY } from "./config";

describe("config", () => {
  it("保存先の名前に題名を入れない", () => {
    expect(SAVE_KEY).not.toContain(GAME_TITLE);
  });

  it("保存先の名前に版の番号を入れない", () => {
    expect(SAVE_KEY).not.toMatch(/v?\d+(\.\d+)*/);
  });
});
