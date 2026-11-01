import { describe, expect, it } from "vitest";
import { AiError } from "./ai";
import { errorText } from "./errors";

describe("errorText (spec 9)", () => {
  it("keeps the app's own plain-words messages", () => {
    expect(errorText(new Error("Finish the current chapter first."))).toBe("Finish the current chapter first.");
    expect(errorText("plain text")).toBe("plain text");
  });

  it("explains full browser storage", () => {
    const quota = new DOMException("The quota has been exceeded.", "QuotaExceededError");
    expect(errorText(quota)).toMatch(/^The browser's storage is full\. Delete a story/);
  });

  it("keeps an AI error that quotes the provider's quota as the no-credit message (decision 58)", () => {
    const message =
      "The account has no credit left. Add credit on the provider's website, then try again. The provider said: “You exceeded your current quota, please check your plan and billing details.”";
    expect(errorText(new AiError(message))).toBe(message);
  });

  it.each([
    "failed to open file at path: C:\\x (os error 5)",
    "Access is denied.",
    "EACCES: permission denied",
  ])("explains a data folder that cannot be written: %s", (raw) => {
    expect(errorText(new Error(raw))).toMatch(/not allowed to write to its data folder\. Check that the folder/);
  });

  it.each(["There is not enough space on the disk. (os error 112)", "ENOSPC: no space left on device"])(
    "explains a full disk: %s",
    (raw) => {
      expect(errorText(new Error(raw))).toBe("The disk is full. Free some space, then try again.");
    },
  );

  it.each([
    "Platform secure storage failure: D-Bus error: The name org.freedesktop.secrets was not provided by any .service files",
    "Couldn't access platform secure storage: org.freedesktop.DBus.Error.ServiceUnknown",
    "org.freedesktop.DBus.Error.AccessDenied: Rejected send message",
  ])("explains a password store that cannot be reached (decision 93): %s", (raw) => {
    expect(errorText(new Error(raw))).toMatch(/^The app could not reach your system's password store, .*GNOME Keyring or KWallet/);
  });

  it("explains a missing file and names it", () => {
    expect(errorText(new Error("File not found: stories/a/setting.md"))).toMatch(
      /^A file the app needs is missing \(File not found: stories\/a\/setting\.md\)\. If you moved or deleted files/,
    );
    expect(errorText(new Error("The system cannot find the path specified. (os error 3)"))).toMatch(/is missing/);
  });
});
