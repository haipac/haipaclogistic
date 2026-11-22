import {
  applicationDefault,
  getApps,
  initializeApp,
  type App,
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { PRODUCTION_FIREBASE_PROJECT_ID } from "@/lib/firebase/project-ids";

function projectId() {
  const project =
    process.env.GCLOUD_PROJECT ??
    process.env.GCP_PROJECT ??
    process.env.FIREBASE_PROJECT_ID;
  const isEmulator = Boolean(
    process.env.FUNCTIONS_EMULATOR ||
    process.env.FIRESTORE_EMULATOR_HOST ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST,
  );

  if (!project) throw new Error("FIREBASE_PROJECT_ID_MISSING");
  if (!isEmulator && project !== PRODUCTION_FIREBASE_PROJECT_ID) {
    throw new Error("FIREBASE_PROJECT_ID_MISMATCH");
  }
  return project;
}

export function getFirebaseAdminApp(): App {
  const existing = getApps().find((candidate) => candidate.name === "haipac");
  if (existing) return existing;

  const currentProject = projectId();
  const isEmulator = Boolean(
    process.env.FUNCTIONS_EMULATOR ||
    process.env.FIRESTORE_EMULATOR_HOST ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST,
  );

  return initializeApp(
    {
      projectId: currentProject,
      ...(isEmulator ? {} : { credential: applicationDefault() }),
    },
    "haipac",
  );
}

export function getFirebaseAdminAuth() {
  return getAuth(getFirebaseAdminApp());
}

export function getFirebaseAdminDb() {
  return getFirestore(getFirebaseAdminApp());
}
