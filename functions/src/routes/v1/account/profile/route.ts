import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { getFirebaseAdminDb } from "@/lib/firebase/admin";
import { requireUser } from "@/lib/firebase/auth";
import { apiFailure, jsonOk, readJson } from "@/lib/api/http";


const ProfileSchema = z.object({
  displayName: z.string().trim().max(100).optional(),
  phone: z.string().trim().max(32).optional(),
}).strict();

export async function PATCH(request: Request) {
  try {
    const user = await requireUser(request);
    const parsed = ProfileSchema.safeParse(await readJson(request, 8 * 1024));
    if (!parsed.success) return jsonOk({ error: "PROFILE_INVALID" }, 400);
    const updates = Object.fromEntries(Object.entries(parsed.data).filter(([, value]) => value !== undefined));
    await getFirebaseAdminDb().collection("users").doc(user.uid).set({
      ...updates,
      email: user.email?.trim().toLowerCase() ?? "",
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return jsonOk({ ok: true });
  } catch (error) {
    return apiFailure(error);
  }
}
