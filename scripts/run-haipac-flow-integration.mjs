import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? "";
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(emulatorHost)) {
  throw new Error("Refusing HAIPAC flow tests without a local Firestore Emulator");
}
if (process.env.FIREBASE_PROJECT_ID !== "haipac-7e19d") {
  throw new Error("Refusing HAIPAC flow tests with an unexpected Firebase project ID");
}

const baseUrl = process.env.HAIPAC_TEST_BASE_URL ?? "http://127.0.0.1:5000";
if (!/^http:\/\/(127\.0\.0\.1|localhost):5000$/.test(baseUrl)) {
  throw new Error("HAIPAC integration tests must call the local Hosting emulator");
}

const deadline = Date.now() + 30_000;
let hostingReady = false;
while (Date.now() < deadline) {
  try {
    const response = await fetch(`${baseUrl}/`);
    if (response.status < 500) {
      hostingReady = true;
      break;
    }
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 250));
}
if (!hostingReady) throw new Error("Firebase Hosting Emulator did not become ready");

const testRun = spawnSync(process.execPath, [
  "--import",
  "tsx",
  "--test",
  "src/lib/logistics/haipac-flow.integration.test.ts",
], {
  cwd: path.join(root, "functions"),
  env: process.env,
  stdio: "inherit",
});

if (testRun.error) throw testRun.error;
process.exitCode = testRun.status ?? 1;
