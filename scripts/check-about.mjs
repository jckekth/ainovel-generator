// Stops the installer build while src/about.config.ts still holds a placeholder
// (spec 10, decision 94). Runs before `npm run build` in the Tauri build only,
// so development builds and tests keep working with the placeholders. Node runs
// the TypeScript file itself (type stripping), so the check reads the real values.
import { placeholdersLeft } from "../src/about.config.ts";

const left = placeholdersLeft();
if (left.length > 0) {
  console.error(
    `The About page still has placeholder values: ${left.join(", ")}.\n` +
      "Put the real values in src/about.config.ts, then build the installer again.",
  );
  process.exit(1);
}
console.log("About page values are set.");
