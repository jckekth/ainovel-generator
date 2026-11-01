import { beforeEach } from "vitest";

// Every test starts with an empty data folder and no saved API key.
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
