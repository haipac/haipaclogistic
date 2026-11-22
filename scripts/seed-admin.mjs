import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const PROJECT_ID = "haipac-7e19d";
const OWNER_EMAIL = "haipaclogistics@gmail.com";

async function main() {
  const uid = process.env.INITIAL_ADMIN_UID?.trim();
  const configuredProject = process.env.FIREBASE_PROJECT_ID ?? process.env.GCP_PROJECT_ID ?? PROJECT_ID;
  if (configuredProject !== PROJECT_ID) throw new Error("Refusing to assign HAIPAC roles outside the approved project.");
  if (!uid) throw new Error("Set INITIAL_ADMIN_UID to the verified Firebase Auth UID of the HAIPAC owner.");
  const app = initializeApp({ projectId: PROJECT_ID, credential: applicationDefault() }, "haipac-initial-admin");
  try {
    const auth = getAuth(app);
    const user = await auth.getUser(uid);
    if (user.email?.toLowerCase() !== OWNER_EMAIL || !user.emailVerified) {
      throw new Error("The requested user must be the verified HAIPAC owner account.");
    }
    await auth.setCustomUserClaims(uid, { ...user.customClaims, haipacRole: "admin" });
    process.stdout.write(`Granted initial HAIPAC administrator role to ${OWNER_EMAIL} (${uid}). Sign in again to refresh claims.\n`);
  } finally {
    await deleteApp(app);
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Admin setup failed."}\n`);
  process.exitCode = 1;
});
