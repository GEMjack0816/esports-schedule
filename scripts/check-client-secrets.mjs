import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const staticDirectory = path.resolve(".next", "static");
if (!existsSync(staticDirectory)) {
  throw new Error("Client build directory is missing; run the production build first.");
}

function javascriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return javascriptFiles(absolute);
    return entry.name.endsWith(".js") ? [absolute] : [];
  });
}

const forbiddenMarkers = ["PANDASCORE_TOKEN"];
const configuredToken = process.env.PANDASCORE_TOKEN?.trim();
if (configuredToken) forbiddenMarkers.push(configuredToken);

const files = javascriptFiles(staticDirectory);
for (const file of files) {
  const content = readFileSync(file, "utf8");
  if (forbiddenMarkers.some((marker) => content.includes(marker))) {
    throw new Error(`A PandaScore credential marker was found in client asset ${path.relative(process.cwd(), file)}`);
  }
}

console.log(`Client credential scan passed (${files.length} JavaScript assets checked).`);
