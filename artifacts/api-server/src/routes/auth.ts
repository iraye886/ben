import { Router, type IRouter, type RequestHandler, type Response } from "express";
import { getAuth } from "@clerk/express";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { businessesTable, db, usersTable } from "@workspace/db";

const router: IRouter = Router();
const ACCESS_COOKIE = "kola_access";
const ACCESS_COOKIE_TTL_MS = 12 * 60 * 60 * 1000;
const accessSecret =
  process.env.ACCESS_PASSKEY_SECRET ||
  process.env.CLERK_SECRET_KEY ||
  "local-development-access-secret";

const onboardingSchema = z.object({
  name: z.string().min(2),
  email: z.email(),
  businessName: z.string().min(2).optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
});

const profileSchema = z.object({
  name: z.string().min(2),
  email: z.email(),
});
const passkeySchema = z.object({
  passkey: z.string().regex(/^\d{6}$/, "Passkey must be exactly 6 digits."),
});

const authUser = (req: Parameters<typeof getAuth>[0]) => {
  const auth = getAuth(req);
  const userId = String(auth?.sessionClaims?.userId || auth?.userId || "");
  return userId ? { auth, userId } : null;
};

export const requireSignedIn: RequestHandler = (req, res, next) => {
  if (!authUser(req)) {
    res.status(401).json({ error: "Sign in required." });
    return;
  }
  next();
};

export const requireRole = (...roles: string[]): RequestHandler => async (req, res, next) => {
  const user = await getSignedInUser(req);
  if (!user || user.status !== "active") {
    res.status(403).json({ error: "Your account is inactive." });
    return;
  }
  if (!user.passkeyHash) {
    res.status(428).json({
      error: "Set up your role passkey to continue.",
      code: "PASSKEY_SETUP_REQUIRED",
    });
    return;
  }
  if (!isAccessVerified(req, user.userId)) {
    res.status(428).json({
      error: "Enter your role passkey to continue.",
      code: "PASSKEY_REQUIRED",
    });
    return;
  }
  if (!roles.includes(user.role)) {
    res.status(403).json({ error: "You do not have permission to access this area." });
    return;
  }
  next();
};

export const getSignedInUser = async (req: Parameters<typeof getAuth>[0]) => {
  const current = authUser(req);
  if (!current) return null;
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, current.userId))
    .limit(1);
  return user ? { ...user, userId: current.userId } : null;
};

const publicUser = (
  user: Awaited<ReturnType<typeof getSignedInUser>>,
  accessVerified = false,
) => {
  if (!user) return null;
  const { passkeyHash: _passkeyHash, userId: _userId, ...safeUser } = user;
  return {
    ...safeUser,
    hasPasskey: Boolean(user.passkeyHash),
    accessVerified,
  };
};

const passkeyDigest = (
  passkey: string,
  salt = randomBytes(16).toString("hex"),
) => {
  const digest = scryptSync(passkey, salt, 64).toString("hex");
  return `${salt}:${digest}`;
};

const matchesPasskey = (passkey: string, stored: string) => {
  const [salt, expectedHex] = stored.split(":");
  if (!salt || !expectedHex) return false;
  const actual = scryptSync(passkey, salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  return expected.length === actual.length && timingSafeEqual(actual, expected);
};

const accessCookieValue = (userId: string, issuedAt: number) => {
  const payload = `${userId}.${issuedAt}`;
  const signature = createHmac("sha256", accessSecret).update(payload).digest("hex");
  return `${payload}.${signature}`;
};

const isAccessVerified = (
  req: Parameters<typeof getAuth>[0],
  userId: string,
) => {
  const raw = req.cookies?.[ACCESS_COOKIE];
  if (typeof raw !== "string") return false;
  const [cookieUserId, issuedAtValue, signature] = raw.split(".");
  const issuedAt = Number(issuedAtValue);
  if (!cookieUserId || !issuedAt || !signature || cookieUserId !== userId) {
    return false;
  }
  if (Date.now() - issuedAt > ACCESS_COOKIE_TTL_MS) return false;
  const expected = createHmac("sha256", accessSecret)
    .update(`${cookieUserId}.${issuedAt}`)
    .digest("hex");
  return (
    signature.length === expected.length &&
    timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  );
};

const issueAccessCookie = (res: Response, userId: string) => {
  res.cookie(ACCESS_COOKIE, accessCookieValue(userId, Date.now()), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: ACCESS_COOKIE_TTL_MS,
    path: "/",
  });
};

router.get("/auth/me", requireSignedIn, async (req, res): Promise<void> => {
  const user = await getSignedInUser(req);
  if (!user) {
    res.status(404).json({ error: "Complete business setup to continue." });
    return;
  }
  res.json({ user: publicUser(user, isAccessVerified(req, user.userId)) });
});

router.post("/auth/passkey/set", requireSignedIn, async (req, res): Promise<void> => {
  const parsed = passkeySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const current = authUser(req)!;
  const user = await getSignedInUser(req);
  if (!user) {
    res.status(404).json({ error: "Complete business setup to continue." });
    return;
  }
  if (user.passkeyHash && !isAccessVerified(req, current.userId)) {
    res.status(428).json({
      error: "Enter your current passkey before changing it.",
      code: "PASSKEY_REQUIRED",
    });
    return;
  }
  const [updated] = await db
    .update(usersTable)
    .set({ passkeyHash: passkeyDigest(parsed.data.passkey), lastActive: new Date() })
    .where(eq(usersTable.clerkUserId, current.userId))
    .returning();
  issueAccessCookie(res, current.userId);
  res.json({ user: publicUser({ ...updated, userId: current.userId }, true) });
});

router.post("/auth/passkey/verify", requireSignedIn, async (req, res): Promise<void> => {
  const parsed = passkeySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const current = authUser(req)!;
  const user = await getSignedInUser(req);
  if (!user || !user.passkeyHash) {
    res.status(400).json({
      error: "Set up a passkey before unlocking this workspace.",
      code: "PASSKEY_SETUP_REQUIRED",
    });
    return;
  }
  if (!matchesPasskey(parsed.data.passkey, user.passkeyHash)) {
    res.status(401).json({ error: "That passkey is not correct." });
    return;
  }
  await db
    .update(usersTable)
    .set({ lastActive: new Date() })
    .where(eq(usersTable.clerkUserId, current.userId));
  issueAccessCookie(res, current.userId);
  res.json({ user: publicUser(user, true) });
});

router.post("/auth/bootstrap", requireSignedIn, async (req, res): Promise<void> => {
  const parsed = onboardingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const current = authUser(req)!;
  const existingByClerk = await getSignedInUser(req);
  if (existingByClerk) {
    res.json({
      user: publicUser(existingByClerk, isAccessVerified(req, existingByClerk.userId)),
      created: false,
    });
    return;
  }
  const [existingInvite] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, parsed.data.email))
    .limit(1);
  if (existingInvite && !existingInvite.clerkUserId) {
    const [linked] = await db
      .update(usersTable)
      .set({ clerkUserId: current.userId, name: parsed.data.name, lastActive: new Date() })
      .where(eq(usersTable.id, existingInvite.id))
      .returning();
    res.json({
      user: publicUser({ ...linked, userId: current.userId }, false),
      created: false,
    });
    return;
  }
  if (!parsed.data.businessName) {
    res.status(400).json({ error: "Business name is required for a new account." });
    return;
  }
  const created = await db.transaction(async (tx) => {
    const [business] = await tx
      .insert(businessesTable)
      .values({
        name: parsed.data.businessName!,
        ownerClerkId: current.userId,
        phone: parsed.data.phone,
        address: parsed.data.address,
      })
      .returning();
    const [user] = await tx
      .insert(usersTable)
      .values({
        name: parsed.data.name,
        email: parsed.data.email,
        clerkUserId: current.userId,
        role: "administrator",
      })
      .returning();
    return { business, user };
  });
  res.status(201).json({
    ...created,
    user: publicUser({ ...created.user, userId: current.userId }, false),
    created: true,
  });
});

router.patch("/auth/profile", requireRole("administrator"), async (req, res): Promise<void> => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const current = authUser(req)!;
  const user = await getSignedInUser(req);
  if (!user) {
    res.status(404).json({ error: "User profile not found." });
    return;
  }
  const [updated] = await db
    .update(usersTable)
    .set({ name: parsed.data.name, email: parsed.data.email, lastActive: new Date() })
    .where(eq(usersTable.clerkUserId, current.userId))
    .returning();
  res.json({ user: updated });
});

export default router;