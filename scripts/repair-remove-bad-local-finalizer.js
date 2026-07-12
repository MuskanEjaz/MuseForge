const fs = require("fs");
const path = require("path");

const appPath = path.join("src", "App.js");

if (!fs.existsSync(appPath)) {
  throw new Error("src/App.js not found");
}

let app = fs.readFileSync(appPath, "utf8");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

fs.copyFileSync(appPath, appPath + ".bak-remove-bad-local-finalizer-" + stamp);

const startMarker = "    // Finalize locally from reviewed FactLock choices.";
const endMarker = "    try {";

const start = app.indexOf(startMarker);

if (start === -1) {
  console.log("✅ Bad local finalizer block not found. Nothing to remove.");
} else {
  const beforeStart = app.lastIndexOf("    setShareUrl('');", start);
  const end = app.indexOf(endMarker, start);

  if (beforeStart === -1 || end === -1) {
    throw new Error("Could not safely locate full bad local finalizer block.");
  }

  const replacement = "    setShareUrl('');\n    setShareStatus('');\n";

  app = app.slice(0, beforeStart) + replacement + app.slice(end);

  fs.writeFileSync(appPath, app, "utf8");

  console.log("✅ Bad local finalizer block removed.");
  console.log("✅ reviewedProjects/reviewedCustomSections/reviewedMeta no-undef error fixed.");
  console.log("✅ Only src/App.js touched.");
  console.log("Backup created: " + appPath + ".bak-remove-bad-local-finalizer-" + stamp);
}
