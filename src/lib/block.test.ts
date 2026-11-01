import { describe, expect, it } from "vitest";
import { parseBlock, stripFlagLines, stripSuggestions, visibleText } from "./block";

const story = "The bell rang.\n\nLin Feng looked up.";

describe("parseBlock (spec 6.3, decision 36)", () => {
  it("splits the story text, the suggested actions and the died flag", () => {
    const raw = `${story}\n\n=== NEXT ===\nClimb the stairs\nWait for the elder\nMAIN CHARACTER DIED: no\n`;
    expect(parseBlock(raw)).toEqual({
      text: story,
      actions: ["Climb the stairs", "Wait for the elder"],
      notes: ["", ""],
      died: false,
      complete: true,
    });
  });

  it("reads the mood line and keeps it out of the actions (spec 6.3, 13)", () => {
    const raw = `${story}\n=== NEXT ===\nRun | Escape\nMAIN CHARACTER DIED: no\n**MOOD:** Battle`;
    const block = parseBlock(raw);
    expect(block.actions).toEqual(["Run"]);
    expect(block.mood).toBe("battle");
  });

  it("gives no mood for none, an unknown mood or no mood line", () => {
    for (const line of ["MOOD: none", "MOOD: calm", "MOOD:", ""]) {
      const block = parseBlock(`${story}\n=== NEXT ===\nRun\nMAIN CHARACTER DIED: no\n${line}`);
      expect(block).not.toHaveProperty("mood");
      expect(block.actions).toEqual(["Run"]);
    }
  });

  it("reads a mood line without the marker, and never shows it", () => {
    const block = parseBlock(`${story}\n\nMOOD: triumphant`);
    expect(block.text).toBe(story);
    expect(block.mood).toBe("triumphant");
  });

  it("reads the died flag (spec 5.5)", () => {
    for (const value of ["yes", "Yes.", "TRUE", "y"]) {
      expect(parseBlock(`${story}\n=== NEXT ===\nRun\nMAIN CHARACTER DIED: ${value}`).died).toBe(true);
    }
    expect(parseBlock(`${story}\n=== NEXT ===\nRun\nmain_character_died: no`).died).toBe(false);
  });

  it("strips list markers, ACTION labels and bold from actions", () => {
    const raw = `${story}\n=== NEXT ===\n1. One\n- Two\n**ACTION: Three**\n**MAIN CHARACTER DIED:** yes`;
    const block = parseBlock(raw);
    expect(block.actions).toEqual(["One", "Two", "Three"]);
    expect(block.died).toBe(true);
  });

  it("keeps at most three actions", () => {
    const raw = `${story}\n=== NEXT ===\nA\nB\nC\nD\nMAIN CHARACTER DIED: no`;
    expect(parseBlock(raw).actions).toEqual(["A", "B", "C"]);
  });

  it("accepts CRLF, a lower-case marker and a different number of = signs", () => {
    const raw = `${story.replace(/\n/g, "\r\n")}\r\n\r\n  ==== next ==  \r\nGo\r\nMAIN CHARACTER DIED: no\r\n`;
    const block = parseBlock(raw);
    expect(block.complete).toBe(true);
    expect(block.text).toBe(story.replace(/\n/g, "\r\n"));
    expect(block.actions).toEqual(["Go"]);
  });

  it("keeps Chinese actions and Chinese list markers", () => {
    const raw = "林风抬起头。\n=== NEXT ===\n1、跟随陌生人\n2、返回宗门\nMAIN CHARACTER DIED: no";
    expect(parseBlock(raw)).toMatchObject({ text: "林风抬起头。", actions: ["跟随陌生人", "返回宗门"] });
  });

  it("keeps a block without the marker as story text with no actions (decision 37)", () => {
    expect(parseBlock(`  ${story}\n\nWhat next?  `)).toEqual({
      text: `${story}\n\nWhat next?`,
      actions: [],
      notes: [],
      died: false,
      complete: false,
    });
  });

  it("does not take a scene break of = signs for the marker", () => {
    expect(parseBlock(`${story}\n\n=====\n\nLater that night.`).complete).toBe(false);
  });

  it("gives empty text for an empty answer", () => {
    expect(parseBlock("  \n=== NEXT ===\nGo").text).toBe("");
    expect(parseBlock("").text).toBe("");
  });
});

describe("visibleText (spec 6.3: only the story text is shown while streaming)", () => {
  it("shows the whole text while no marker has arrived", () => {
    expect(visibleText("The bell rang.\nLin")).toBe("The bell rang.\nLin");
  });

  it("hides everything from the marker on", () => {
    expect(visibleText(`${story}\n\n=== NEXT ===\nClimb`)).toBe(story);
  });

  it("holds back a last line that may become the marker", () => {
    expect(visibleText(`${story}\n\n==`)).toBe(story);
    expect(visibleText(`${story}\n=== NE`)).toBe(story);
    expect(visibleText("=")).toBe("");
  });

  it("holds back a last line that may become the mood line, and hides a whole one", () => {
    expect(visibleText(`${story}\nMOO`)).toBe(story);
    expect(visibleText(`${story}\nMOOD: sa`)).toBe(story);
    expect(visibleText(`${story}\nMOOD: sad\n`)).toBe(story);
    expect(visibleText(`${story}\nMoody clouds`)).toBe(`${story}\nMoody clouds`);
  });
});

describe("a flag line without the marker (decision 54)", () => {
  // Seen with a real provider: the === NEXT === line was left out, the flag line was not.
  const raw = "“Then this is an excellent time to start one.”\n\nMAIN CHARACTER DIED: no";

  it("keeps the flag line out of the story text", () => {
    expect(parseBlock(raw)).toEqual({
      text: "“Then this is an excellent time to start one.”",
      actions: [],
      notes: [],
      died: false,
      complete: false,
    });
  });

  it("still reads the flag, so a death pauses the story", () => {
    expect(parseBlock("He fell.\n**MAIN CHARACTER DIED:** yes").died).toBe(true);
    expect(parseBlock("He fell.\nmain_character_died: yes\n").text).toBe("He fell.");
  });

  it("leaves story lines that only mention the words alone", () => {
    const text = "The sign said: MAIN CHARACTER DIED: no one remembers why.\nShe laughed.";
    expect(stripFlagLines("A\nMAIN CHARACTER DIED: no\nB")).toBe("A\nB");
    expect(parseBlock(text).text).toBe(text);
  });

  it("hides the flag line while it streams in", () => {
    expect(visibleText("She laughed.\n\nMAIN CHAR")).toBe("She laughed.");
    expect(visibleText("She laughed.\n\n**MAIN CHARACTER DIED:")).toBe("She laughed.");
    expect(visibleText("She laughed.\n\nMAIN CHARACTER DIED: no")).toBe("She laughed.");
    expect(visibleText("She laughed.\nMAIN CHARACTER DIED: no\nAnd then")).toBe("She laughed.\nAnd then");
    // A story line that only starts like the flag shows once it differs.
    expect(visibleText("She laughed.\nMaybe")).toBe("She laughed.\nMaybe");
  });
});

describe("suggested action notes (spec 6.3, decision 86)", () => {
  it("splits each action from its note at a bar, ASCII or full-width", () => {
    const raw = `${story}\n=== NEXT ===\n1. Climb the stairs | Meets the elder early\n- 林峰轉身離開｜錯過機緣\nWait\nMAIN CHARACTER DIED: no`;
    const block = parseBlock(raw);
    expect(block.actions).toEqual(["Climb the stairs", "林峰轉身離開", "Wait"]);
    expect(block.notes).toEqual(["Meets the elder early", "錯過機緣", ""]);
  });

  it("drops a line that is only a note", () => {
    expect(parseBlock(`${story}\n=== NEXT ===\n| no action here\nRun | Escape\nMAIN CHARACTER DIED: no`).actions).toEqual(["Run"]);
  });
});

describe("a marker glued to the end of the story text (bug 2026-10-22)", () => {
  // As seen with a real provider: no line break before the marker, and no flag line.
  const raw = "林峰走进山洞。\n\n这回，它朝着矿洞的方向，轻轻偏转。=== NEXT ===\n方寒借口查看山道 | 暗中逼近矿洞\n方寒提醒陆沉 | 与剑宗正面交锋";

  it("still splits the story text from the suggested actions and notes", () => {
    const block = parseBlock(raw);
    expect(block.text).toBe("林峰走进山洞。\n\n这回，它朝着矿洞的方向，轻轻偏转。");
    expect(block.actions).toEqual(["方寒借口查看山道", "方寒提醒陆沉"]);
    expect(block.notes).toEqual(["暗中逼近矿洞", "与剑宗正面交锋"]);
    expect(block.complete).toBe(true);
  });

  it("never shows the marker or what follows while streaming, nor a marker still arriving", () => {
    expect(visibleText(raw)).toBe("林峰走进山洞。\n\n这回，它朝着矿洞的方向，轻轻偏转。");
    expect(visibleText("轻轻偏转。=== NE")).toBe("轻轻偏转。");
    expect(visibleText("轻轻偏转。==")).toBe("轻轻偏转。");
  });

  it("still keeps a scene break of = signs as story text", () => {
    expect(parseBlock("Part one.\n\n=====\n\nPart two.").text).toBe("Part one.\n\n=====\n\nPart two.");
  });
});

describe("the note separator (decision 86)", () => {
  it("keeps the letters next to the bar", () => {
    const block = parseBlock("Text.\n=== NEXT ===\nVisit the sects|Trouble starts\nRun\nMAIN CHARACTER DIED: no");
    expect(block.actions[0]).toBe("Visit the sects");
    expect(block.notes[0]).toBe("Trouble starts");
  });
});

describe("stripSuggestions (decision 90)", () => {
  it("drops the marker and its suggestion lines from saved text, up to the next paragraph", () => {
    const saved = "第一段。\n\n轻轻偏转。=== NEXT ===\n查看山道 | 逼近矿洞\n离开\n\n第二段。";
    expect(stripSuggestions(saved)).toBe("第一段。\n\n轻轻偏转。\n\n第二段。");
    expect(stripSuggestions("No marker here.")).toBe("No marker here.");
  });
});
