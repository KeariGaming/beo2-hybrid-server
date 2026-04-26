const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { MongoClient } = require("mongodb");

const app = express();
app.disable("x-powered-by");

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS)
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);

const CROSSDOMAIN_ALLOWED = (process.env.CROSSDOMAIN_ALLOWED || "*")
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);

app.use(cors({
    origin(origin, callback) {
        if (!origin) return callback(null, true);
        if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
        return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true, limit: "16kb" }));

app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    next();
});

const uri = process.env.MONGO_URI;
const ADMIN_KEY = process.env.ADMIN_KEY;
const PORT = process.env.PORT || 3000;

if (!uri) {
    throw new Error("Missing MONGO_URI");
}
if (!ADMIN_KEY) {
    throw new Error("Missing ADMIN_KEY");
}

const client = new MongoClient(uri);

let playersCollection;
let sessionsCollection;
let redeemCodesCollection;

const SESSION_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours
const ALLOWED_SHELL_MIN = 1;
const ALLOWED_SHELL_MAX = 10000;
const MAX_ROOM_USERS = 50;
const EXCLUSIVE_SHELL_START_ID = 180;
const DEFAULT_SHELL_ID = 1;

const ALLOWED_TAG_MIN = 0;
const ALLOWED_TAG_MAX = 1000;

const ALLOWED_EFFECT_MIN = 0;
const ALLOWED_EFFECT_MAX = 1000;

const ALLOWED_BADGE_MIN = 0;
const ALLOWED_BADGE_MAX = 10000;

const ALLOWED_BADGE_BG_MIN = 0;
const ALLOWED_BADGE_BG_MAX = 10000;

const LOCKED_TAG_START_ID = 1;
const DEFAULT_TAG_ID = 0;

const LOCKED_EFFECT_START_ID = 1;
const DEFAULT_EFFECT_ID = 0;

function normalizeOwnedTags(arr) {
    if (!Array.isArray(arr)) return [];
    return arr
        .map(v => parseInt(v, 10))
        .filter(v => Number.isInteger(v));
}

function normalizeRedeemCode(value) {
    return String(value || "")
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "");
}

function normalizeOwnedEffects(arr) {
    if (!Array.isArray(arr)) return [];
    return arr
        .map(v => parseInt(v, 10))
        .filter(v => Number.isInteger(v));
}

function canPlayerEquipTag(playerDoc, tagId) {
    if (!Number.isInteger(tagId)) {
        return false;
    }

    if (tagId < LOCKED_TAG_START_ID) {
        return true;
    }

    const ownedTags = normalizeOwnedTags(playerDoc?.ownedTags);
    return ownedTags.indexOf(tagId) !== -1;
}

function canPlayerEquipEffect(playerDoc, effectId) {
    if (!Number.isInteger(effectId)) {
        return false;
    }

    if (effectId < LOCKED_EFFECT_START_ID) {
        return true;
    }

    const ownedEffects = normalizeOwnedEffects(playerDoc?.ownedEffects);
    return ownedEffects.indexOf(effectId) !== -1;
}

function normalizeOwnedShells(arr) {
    if (!Array.isArray(arr)) return [];
    return arr
        .map(v => parseInt(v, 10))
        .filter(v => Number.isInteger(v));
}


function isValidHexColor(value) {
    if (value === "") return true;
    return typeof value === "string" && /^#?[0-9a-fA-F]{6}$/.test(value);
}

function normalizeHexColor(value) {
    value = String(value || "").trim();
    if (value === "") return "";
    if (!value.startsWith("#")) {
        value = "#" + value;
    }
    return value.toLowerCase();
}

function canPlayerEquipShell(playerDoc, shellId) {
    if (!Number.isInteger(shellId)) {
        return false;
    }

    if (shellId < EXCLUSIVE_SHELL_START_ID) {
        return true;
    }

    const ownedShells = normalizeOwnedShells(playerDoc?.ownedShells);
    return ownedShells.indexOf(shellId) !== -1;
}

const rateStore = new Map();

function makeToken() {
    return crypto.randomBytes(32).toString("hex");
}

function hashToken(token) {
    return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function normalizePassword(value) {
    return String(value || "");
}

function makeHybridPasswordHash(username, connectUserId, password) {
    return crypto
        .createHash("sha256")
        .update(
            `${sanitizeUsername(username)}|${sanitizeConnectUserId(connectUserId)}|${normalizePassword(password)}`,
            "utf8"
        )
        .digest("hex");
}

function nowTs() {
    return Date.now();
}

function isValidShellOverride(value) {
    return Number.isInteger(value) && value >= ALLOWED_SHELL_MIN && value <= ALLOWED_SHELL_MAX;
}

function isValidTagId(value) {
    return Number.isInteger(value) && value >= ALLOWED_TAG_MIN && value <= ALLOWED_TAG_MAX;
}

function isValidEffectId(value) {
    return Number.isInteger(value) && value >= ALLOWED_EFFECT_MIN && value <= ALLOWED_EFFECT_MAX;
}

function isValidBadgeOverride(value) {
    return Number.isInteger(value) && value >= ALLOWED_BADGE_MIN && value <= ALLOWED_BADGE_MAX;
}

function isValidBadgeBackgroundOverride(value) {
    return Number.isInteger(value) && value >= ALLOWED_BADGE_BG_MIN && value <= ALLOWED_BADGE_BG_MAX;
}

function isValidUsername(name) {
    return typeof name === "string" && /^[a-z0-9_.\- ]{3,30}$/.test(sanitizeUsername(name));
}

function isValidConnectUserId(value) {
    value = sanitizeConnectUserId(value);
    return /^[A-Za-z0-9_\-:. ]{6,128}$/.test(value);
}

function isValidBadgeOverride(value) {
    return Number.isInteger(value) && value >= 0 && value <= 10000;
}

function sanitizeConnectUserId(value) {
    return String(value || "")
        .trim()
        .replace(/\s+/g, " ");
}

function sanitizeUsername(name) {
    return String(name || "")
        .trim()                 // remove start/end spaces
        .toLowerCase()          // normalize casing
        .replace(/\s+/g, " ");  // collapse multiple spaces into one
}

function getClientIp(req) {
    return (
        req.headers["cf-connecting-ip"] ||
        req.headers["x-forwarded-for"] ||
        req.socket.remoteAddress ||
        "unknown"
    ).toString().split(",")[0].trim();
}

function rateLimit(limit, windowMs) {
    return (req, res, next) => {
        const key = `${getClientIp(req)}|${req.path}`;
        const currentTime = nowTs();
        let entry = rateStore.get(key);

        if (!entry || entry.resetAt <= currentTime) {
            entry = { count: 0, resetAt: currentTime + windowMs };
            rateStore.set(key, entry);
        }

        entry.count++;

        if (entry.count > limit) {
            return res.status(429).json({ error: "Too many requests" });
        }

        next();
    };
}

function requireAdmin(req, res, next) {
    const auth = req.headers.authorization || "";
    const prefix = "Bearer ";
    if (!auth.startsWith(prefix)) {
        return res.status(403).json({ error: "Unauthorized" });
    }

    const token = auth.slice(prefix.length);
    if (token !== ADMIN_KEY) {
        return res.status(403).json({ error: "Unauthorized" });
    }

    next();
}


async function getValidSession(rawToken) {
    if (!rawToken) {
        return null;
    }

    const tokenHash = hashToken(rawToken);
    const session = await sessionsCollection.findOne({ tokenHash });

    if (!session) {
        return null;
    }

    if (session.expiresAt <= nowTs()) {
        await sessionsCollection.deleteOne({ _id: session._id });
        return null;
    }

    return session;
}

async function ensurePlayerExists(username) {
    await playersCollection.updateOne(
        { name: username },
        {
            $setOnInsert: {
                name: username,
                connectUserId: "",
                hybridPasswordHash: "",
                tagId: 0,
                effectId: 0,
                color: "",
                shellOverride: 0,
                badgeOverride: 0,
                badgeBackgroundOverride: 0,
                ownedShells: [],
                ownedTags: [],
                ownedEffects: [],
                updatedAt: nowTs()
            }
        },
        { upsert: true }
    );
}

async function start() {
    try {
        await client.connect();

        const db = client.db("beo2");
        playersCollection = db.collection("players");
        sessionsCollection = db.collection("sessions");
        redeemCodesCollection = db.collection("redeemCodes");

        await playersCollection.createIndex({ name: 1 }, { unique: true });
        await playersCollection.createIndex({ updatedAt: 1 });

        await redeemCodesCollection.createIndex({ code: 1 }, { unique: true });
        await redeemCodesCollection.createIndex({ active: 1 });
        
        await sessionsCollection.deleteMany({
           $or: [
              { tokenHash: { $exists: false } },
              { tokenHash: null },
              { expiresAt: { $lte: Date.now() } }
           ]
        });

        await sessionsCollection.createIndex(
           { tokenHash: 1 },
           {
              unique: true,
              partialFilterExpression: { tokenHash: { $type: "string" } }
           }
        );

        await sessionsCollection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
        await sessionsCollection.createIndex({ name: 1 });
        await sessionsCollection.createIndex({ connectUserId: 1 });
        console.log("MongoDB connected");

        app.listen(PORT, () => {
            console.log("Running on port", PORT);
        });
    } catch (err) {
        console.error("MongoDB connection error:", err);
        process.exit(1);
    }
}

start();

app.get("/", (req, res) => {
    res.send("Server running");
});

app.get("/crossdomain.xml", (req, res) => {
    res.type("application/xml");

    const xml = [
        '<?xml version="1.0"?>',
        '<!DOCTYPE cross-domain-policy SYSTEM "http://www.adobe.com/xml/dtds/cross-domain-policy.dtd">',
        '<cross-domain-policy>',
        '   <site-control permitted-cross-domain-policies="all"/>',
        ...CROSSDOMAIN_ALLOWED.map(domain =>
            `   <allow-access-from domain="${domain}" secure="true" />`
        ),
        '</cross-domain-policy>'
    ].join("\n");

    res.send(xml);
});

app.get("/register", rateLimit(30, 60 * 1000), async (req, res) => {
    const username = sanitizeUsername(req.query.username);

    if (!isValidUsername(username)) {
        return res.status(400).send("Invalid username");
    }

    try {
        await ensurePlayerExists(username);
        return res.send("OK");
    } catch (err) {
        console.error("register error:", err);
        return res.status(500).send("Error");
    }
});

app.post("/hybridStatus", rateLimit(20, 60 * 1000), async (req, res) => {
    const username = sanitizeUsername(req.body.username);
    const connectUserId = sanitizeConnectUserId(req.body.connectUserId);

    if (!isValidUsername(username) || !isValidConnectUserId(connectUserId)) {
        return res.status(400).json({ error: "Invalid username or connectUserId" });
    }

    try {
        await ensurePlayerExists(username);

        const existingPlayer = await playersCollection.findOne({ name: username });

        if (!existingPlayer) {
            return res.status(500).json({ error: "Player lookup failed" });
        }

        if (
            existingPlayer.connectUserId &&
            existingPlayer.connectUserId !== "" &&
            existingPlayer.connectUserId !== connectUserId
        ) {
            return res.status(403).json({
                error: "Username already bound to a different connectUserId"
            });
        }

        const conflict = await playersCollection.findOne({
            connectUserId,
            name: { $ne: username }
        });

        if (conflict) {
            return res.status(403).json({
                error: "connectUserId already bound to another username"
            });
        }

        return res.json({
            ok: true,
            hasHybridPassword: !!(existingPlayer.hybridPasswordHash && existingPlayer.hybridPasswordHash !== "")
        });
    } catch (err) {
        console.error("hybridStatus error:", err);
        return res.status(500).json({ error: "Error" });
    }
});

app.post("/registerSession", rateLimit(20, 60 * 1000), async (req, res) => {
    const username = sanitizeUsername(req.body.username);
    const connectUserId = sanitizeConnectUserId(req.body.connectUserId);
    const password = normalizePassword(req.body.password);

    if (!isValidUsername(username) || !isValidConnectUserId(connectUserId)) {
        return res.status(400).json({ error: "Invalid username or connectUserId" });
    }

    if (!password || password.length < 1 || password.length > 128) {
        return res.status(400).json({ error: "Missing or invalid password" });
    }

    try {
        await ensurePlayerExists(username);

        const existingPlayer = await playersCollection.findOne({ name: username });

        if (!existingPlayer) {
            return res.status(500).json({ error: "Player lookup failed" });
        }

        if (
            existingPlayer.connectUserId &&
            existingPlayer.connectUserId !== "" &&
            existingPlayer.connectUserId !== connectUserId
        ) {
            return res.status(403).json({
                error: "Username already bound to a different connectUserId"
            });
        }

        const conflict = await playersCollection.findOne({
            connectUserId,
            name: { $ne: username }
        });

        if (conflict) {
            return res.status(403).json({
                error: "connectUserId already bound to another username"
            });
        }

        const incomingHash = makeHybridPasswordHash(username, connectUserId, password);

        // first successful PlayerIO login for this hybrid account:
        if (!existingPlayer.hybridPasswordHash || existingPlayer.hybridPasswordHash === "") {
            await playersCollection.updateOne(
                { name: username },
                {
                    $set: {
                        connectUserId,
                        hybridPasswordHash: incomingHash,
                        updatedAt: nowTs()
                    }
                }
            );
        } else {
            // already registered on hybrid side -> password must match
            if (existingPlayer.hybridPasswordHash !== incomingHash) {
                return res.status(403).json({
                    error: "Wrong hybrid password"
                });
            }

            // keep connectUserId refreshed just in case it was blank before
            await playersCollection.updateOne(
                { name: username },
                {
                    $set: {
                        connectUserId,
                        updatedAt: nowTs()
                    }
                }
            );
        }

        const token = makeToken();
        const tokenHash = hashToken(token);
        const expiresAt = nowTs() + SESSION_TTL_MS;

        await sessionsCollection.deleteMany({
            $or: [
                { name: username },
                { connectUserId }
            ]
        });

        await sessionsCollection.insertOne({
            tokenHash,
            name: username,
            connectUserId,
            expiresAt,
            createdAt: nowTs()
        });

        return res.json({
            ok: true,
            token,
            expiresAt
        });
    } catch (err) {
        console.error("registerSession error:", err);
        return res.status(500).json({ error: "Error" });
    }
});

app.post("/redeemCode", rateLimit(10, 60 * 1000), async (req, res) => {
    const token = String(req.body.token || "");
    const code = normalizeRedeemCode(req.body.code);

    if (!token) {
        return res.status(400).json({ error: "Missing token" });
    }

    if (!code || code.length < 3 || code.length > 64) {
        return res.status(400).json({ error: "Code invalid" });
    }

    try {
        const session = await getValidSession(token);

        if (!session) {
            return res.status(403).json({ error: "Invalid or expired session" });
        }

        const redeemDoc = await redeemCodesCollection.findOne({ code, active: true });

        if (!redeemDoc) {
            return res.status(404).json({ error: "Code invalid" });
        }

        const usedBy = Array.isArray(redeemDoc.usedBy) ? redeemDoc.usedBy : [];
        const maxUses = Number.isInteger(redeemDoc.maxUses) ? redeemDoc.maxUses : 1;

        if (usedBy.indexOf(session.name) !== -1) {
            return res.status(403).json({ error: "You already redeemed this code!" });
        }

        if (usedBy.length >= maxUses) {
            return res.status(403).json({ error: "Code Limit Reached" });
        }

        const rewards = redeemDoc.rewards || {};
        const ownedShells = normalizeOwnedShells(rewards.ownedShells);
        const ownedTags = normalizeOwnedTags(rewards.ownedTags);
        const ownedEffects = normalizeOwnedEffects(rewards.ownedEffects);

        const playerUpdate = {
            $set: {
                updatedAt: nowTs()
            }
        };

        if (ownedShells.length > 0 || ownedTags.length > 0 || ownedEffects.length > 0) {
            playerUpdate.$addToSet = {};
        }

        if (ownedShells.length > 0) {
            playerUpdate.$addToSet.ownedShells = { $each: ownedShells };
        }

        if (ownedTags.length > 0) {
            playerUpdate.$addToSet.ownedTags = { $each: ownedTags };
        }

        if (ownedEffects.length > 0) {
            playerUpdate.$addToSet.ownedEffects = { $each: ownedEffects };
        }

        await playersCollection.updateOne(
            { name: session.name, connectUserId: session.connectUserId },
            playerUpdate
        );

        await redeemCodesCollection.updateOne(
            { _id: redeemDoc._id },
            {
                $addToSet: { usedBy: session.name },
                $set: { updatedAt: nowTs() }
            }
        );

        const popup = redeemDoc.popup || {};

        return res.json({
            ok: true,
            code,
            granted: {
                ownedShells,
                ownedTags,
                ownedEffects
            },
            popup: {
                title: popup.title || "Redeem Code",
                message: popup.message || "Code redeemed successfully!",
                iconClass: popup.iconClass || "Icon_Thumb"
            }
        });
    } catch (err) {
        console.error("redeemCode error:", err);
        return res.status(500).json({ error: "Error" });
    }
});

app.post("/setMyBadge", rateLimit(60, 60 * 1000), async (req, res) => {
    const token = String(req.body.token || "");
    const badgeOverride = parseInt(req.body.badgeOverride, 10);

    if (!token) {
        return res.status(400).json({ error: "Missing token" });
    }

    if (!isValidBadgeOverride(badgeOverride)) {
        return res.status(400).json({ error: "Invalid badgeOverride" });
    }

    try {
        const session = await getValidSession(token);

        if (!session) {
            return res.status(403).json({ error: "Invalid or expired session" });
        }

        await playersCollection.updateOne(
            { name: session.name, connectUserId: session.connectUserId },
            {
                $set: {
                    badgeOverride,
                    updatedAt: nowTs()
                }
            }
        );

        return res.json({
            ok: true,
            name: session.name,
            badgeOverride
        });
    } catch (err) {
        console.error("setMyBadge error:", err);
        return res.status(500).json({ error: "Error" });
    }
});

app.post("/setMyBadgeBackground", rateLimit(60, 60 * 1000), async (req, res) => {
    const token = String(req.body.token || "");
    const badgeBackgroundOverride = parseInt(req.body.badgeBackgroundOverride, 10);

    if (!token) {
        return res.status(400).json({ error: "Missing token" });
    }

    if (!isValidBadgeOverride(badgeBackgroundOverride)) {
        return res.status(400).json({ error: "Invalid badgeBackgroundOverride" });
    }

    try {
        const session = await getValidSession(token);

        if (!session) {
            return res.status(403).json({ error: "Invalid or expired session" });
        }

        await playersCollection.updateOne(
            { name: session.name, connectUserId: session.connectUserId },
            {
                $set: {
                    badgeBackgroundOverride,
                    updatedAt: nowTs()
                }
            }
        );

        return res.json({
            ok: true,
            name: session.name,
            badgeBackgroundOverride
        });
    } catch (err) {
        console.error("setMyBadgeBackground error:", err);
        return res.status(500).json({ error: "Error" });
    }
});

app.post("/setMyShell", rateLimit(60, 60 * 1000), async (req, res) => {
    const token = String(req.body.token || "");
    const requestedShell = parseInt(req.body.shellOverride, 10);

    if (!token) {
        return res.status(400).json({ error: "Missing token" });
    }

    if (!isValidShellOverride(requestedShell)) {
        return res.status(400).json({ error: "Invalid shellOverride" });
    }

    try {
        const session = await getValidSession(token);

        if (!session) {
            return res.status(403).json({ error: "Invalid or expired session" });
        }

        const playerDoc = await playersCollection.findOne(
            { name: session.name, connectUserId: session.connectUserId },
            {
                projection: {
                    _id: 0,
                    ownedShells: 1
                }
            }
        );

        if (!playerDoc) {
            return res.status(404).json({ error: "Player not found" });
        }

        const finalShell = canPlayerEquipShell(playerDoc, requestedShell)
            ? requestedShell
            : DEFAULT_SHELL_ID;

        await playersCollection.updateOne(
            { name: session.name, connectUserId: session.connectUserId },
            {
                $set: {
                    shellOverride: finalShell,
                    updatedAt: nowTs()
                }
            }
        );

        return res.json({
            ok: true,
            name: session.name,
            shellOverride: finalShell,
            requestedShell,
            fallback: finalShell !== requestedShell
        });
    } catch (err) {
        console.error("setMyShell error:", err);
        return res.status(500).json({ error: "Error" });
    }
});

app.post("/setMyTag", rateLimit(60, 60 * 1000), async (req, res) => {
    const token = String(req.body.token || "");
    const requestedTagId = parseInt(req.body.tagId, 10);

    if (!token) {
        return res.status(400).json({ error: "Missing token" });
    }

    if (!isValidTagId(requestedTagId)) {
        return res.status(400).json({ error: "Invalid tagId" });
    }

    try {
        const session = await getValidSession(token);

        if (!session) {
            return res.status(403).json({ error: "Invalid or expired session" });
        }

        const playerDoc = await playersCollection.findOne(
            { name: session.name, connectUserId: session.connectUserId },
            {
                projection: {
                    _id: 0,
                    ownedTags: 1
                }
            }
        );

        if (!playerDoc) {
            return res.status(404).json({ error: "Player not found" });
        }

        const finalTagId = canPlayerEquipTag(playerDoc, requestedTagId)
            ? requestedTagId
            : DEFAULT_TAG_ID;

        await playersCollection.updateOne(
            { name: session.name, connectUserId: session.connectUserId },
            {
                $set: {
                    tagId: finalTagId,
                    updatedAt: nowTs()
                }
            }
        );

        return res.json({
            ok: true,
            name: session.name,
            tagId: finalTagId,
            requestedTagId,
            fallback: finalTagId !== requestedTagId
        });
    } catch (err) {
        console.error("setMyTag error:", err);
        return res.status(500).json({ error: "Error" });
    }
});

app.post("/setMyEffect", rateLimit(60, 60 * 1000), async (req, res) => {
    const token = String(req.body.token || "");
    const requestedEffectId = parseInt(req.body.effectId, 10);

    if (!token) {
        return res.status(400).json({ error: "Missing token" });
    }

    if (!isValidEffectId(requestedEffectId)) {
        return res.status(400).json({ error: "Invalid effectId" });
    }

    try {
        const session = await getValidSession(token);

        if (!session) {
            return res.status(403).json({ error: "Invalid or expired session" });
        }

        const playerDoc = await playersCollection.findOne(
            { name: session.name, connectUserId: session.connectUserId },
            {
                projection: {
                    _id: 0,
                    ownedEffects: 1
                }
            }
        );

        if (!playerDoc) {
            return res.status(404).json({ error: "Player not found" });
        }

        const finalEffectId = canPlayerEquipEffect(playerDoc, requestedEffectId)
            ? requestedEffectId
            : DEFAULT_EFFECT_ID;

        await playersCollection.updateOne(
            { name: session.name, connectUserId: session.connectUserId },
            {
                $set: {
                    effectId: finalEffectId,
                    updatedAt: nowTs()
                }
            }
        );

        return res.json({
            ok: true,
            name: session.name,
            effectId: finalEffectId,
            requestedEffectId,
            fallback: finalEffectId !== requestedEffectId
        });
    } catch (err) {
        console.error("setMyEffect error:", err);
        return res.status(500).json({ error: "Error" });
    }
});

app.get("/getPlayer", rateLimit(120, 60 * 1000), async (req, res) => {
    const username = sanitizeUsername(req.query.username);

    if (!isValidUsername(username)) {
        return res.json({});
    }

    try {
        const player = await playersCollection.findOne(
            { name: username },
            {
                projection: {
                    _id: 0,
                    tagId: 1,
                    effectId: 1,
                    color: 1,
                    shellOverride: 1,
                    badgeOverride: 1,
                    badgeBackgroundOverride: 1,
                    ownedShells: 1,
                    ownedTags: 1,
                    ownedEffects: 1,
                    updatedAt: 1
                }
            }
        );

        if (!player) {
            return res.json({});
        }

        return res.json({
            tagId: player.tagId || 0,
            effectId: player.effectId || 0,
            color: player.color || "",
            shellOverride: player.shellOverride || 0,
            badgeOverride: player.badgeOverride || 0,
            badgeBackgroundOverride: player.badgeBackgroundOverride || 0,
            ownedShells: normalizeOwnedShells(player.ownedShells),
            ownedTags: normalizeOwnedTags(player.ownedTags),
            ownedEffects: normalizeOwnedEffects(player.ownedEffects),
            updatedAt: player.updatedAt || 0
        });
    } catch (err) {
        console.error("getPlayer error:", err);
        return res.status(500).send("Error");
    }
});

app.get("/getRoomHybridUpdates", rateLimit(120, 60 * 1000), async (req, res) => {
    const usersParam = String(req.query.users || "");
    const since = parseInt(req.query.since ?? "0", 10) || 0;

    if (!usersParam) {
        return res.json([]);
    }

    const usernames = [...new Set(
        usersParam
            .split(",")
            .map(x => sanitizeUsername(x))
            .filter(x => isValidUsername(x))
    )];

    if (usernames.length === 0) {
        return res.json([]);
    }

    if (usernames.length > MAX_ROOM_USERS) {
        return res.status(400).json({ error: "Too many users" });
    }

    try {
        const players = await playersCollection.find(
            {
                name: { $in: usernames },
                updatedAt: { $gt: since }
            },
            {
                projection: {
                    _id: 0,
                    name: 1,
                    tagId: 1,
                    effectId: 1,
                    color: 1,
                    shellOverride: 1,
                    badgeOverride: 1,
                    badgeBackgroundOverride: 1,
                    updatedAt: 1
                }
            }
        ).toArray();

        return res.json(players.map(player => ({
            name: player.name,
            tagId: player.tagId || 0,
            effectId: player.effectId || 0,
            color: player.color || "",
            shellOverride: player.shellOverride || 0,
            badgeOverride: player.badgeOverride || 0,
            badgeBackgroundOverride: player.badgeBackgroundOverride || 0,
            updatedAt: player.updatedAt || 0
        })));
    } catch (err) {
        console.error("getRoomHybridUpdates error:", err);
        return res.status(500).json({ error: "Error" });
    }
});

app.post("/admin/setTag", rateLimit(30, 60 * 1000), requireAdmin, async (req, res) => {
    const username = sanitizeUsername(req.body.user);
    const tagId = parseInt(req.body.tagId ?? "0", 10) || 0;
    const effectId = parseInt(req.body.effectId ?? "0", 10) || 0;
    const color = normalizeHexColor(req.body.color ?? "");
    const shellOverride = parseInt(req.body.shellOverride ?? "0", 10) || 0;
    const badgeOverride = parseInt(req.body.badgeOverride ?? "0", 10) || 0;
    const badgeBackgroundOverride = parseInt(req.body.badgeBackgroundOverride ?? "0", 10) || 0;
    const ownedShells = Array.isArray(req.body.ownedShells) ? req.body.ownedShells : undefined;

    if (!isValidUsername(username)) {
        return res.status(400).json({ error: "Invalid user" });
    }

    if (!isValidTagId(tagId)) {
        return res.status(400).json({ error: "Invalid tagId" });
    }

    if (!isValidEffectId(effectId)) {
        return res.status(400).json({ error: "Invalid effectId" });
    }

    if (!isValidHexColor(color)) {
        return res.status(400).json({ error: "Invalid color" });
    }

    if (shellOverride !== 0 && !isValidShellOverride(shellOverride)) {
        return res.status(400).json({ error: "Invalid shellOverride" });
    }

    if (!isValidBadgeOverride(badgeOverride)) {
        return res.status(400).json({ error: "Invalid badgeOverride" });
    }

    if (!isValidBadgeBackgroundOverride(badgeBackgroundOverride)) {
        return res.status(400).json({ error: "Invalid badgeBackgroundOverride" });
    }

    try {
        const update = {
            tagId,
            effectId,
            color,
            shellOverride,
            badgeOverride,
            badgeBackgroundOverride,
            updatedAt: nowTs()
        };

        if (ownedShells !== undefined) {
            update.ownedShells = normalizeOwnedShells(ownedShells);
        }

        await ensurePlayerExists(username);

        await playersCollection.updateOne(
            { name: username },
            { $set: update }
        );

        return res.json({
            ok: true,
            user: username,
            update
        });
    } catch (err) {
        console.error("admin/setTag error:", err);
        return res.status(500).json({ error: "Error" });
    }
});

app.post("/admin/grantTag", rateLimit(30, 60 * 1000), requireAdmin, async (req, res) => {
    const username = sanitizeUsername(req.body.user);
    const tagId = parseInt(req.body.tagId, 10);

    if (!isValidUsername(username)) {
        return res.status(400).json({ error: "Invalid user" });
    }

    if (!isValidTagId(tagId) || tagId < LOCKED_TAG_START_ID) {
        return res.status(400).json({ error: "Invalid tagId" });
    }

    try {
        await ensurePlayerExists(username);

        await playersCollection.updateOne(
            { name: username },
            {
                $addToSet: { ownedTags: tagId },
                $set: { updatedAt: nowTs() }
            }
        );

        return res.json({ ok: true, user: username, tagId });
    } catch (err) {
        console.error("admin/grantTag error:", err);
        return res.status(500).json({ error: "Error" });
    }
});

app.post("/admin/revokeTag", rateLimit(30, 60 * 1000), requireAdmin, async (req, res) => {
    const username = sanitizeUsername(req.body.user);
    const tagId = parseInt(req.body.tagId, 10);

    if (!isValidUsername(username)) {
        return res.status(400).json({ error: "Invalid user" });
    }

    if (!isValidTagId(tagId) || tagId < LOCKED_TAG_START_ID) {
        return res.status(400).json({ error: "Invalid tagId" });
    }

    try {
        await playersCollection.updateOne(
            { name: username },
            {
                $pull: { ownedTags: tagId },
                $set: { updatedAt: nowTs() }
            }
        );

        const playerDoc = await playersCollection.findOne(
            { name: username },
            { projection: { _id: 0, tagId: 1 } }
        );

        if (playerDoc && parseInt(playerDoc.tagId, 10) === tagId) {
            await playersCollection.updateOne(
                { name: username },
                {
                    $set: {
                        tagId: DEFAULT_TAG_ID,
                        updatedAt: nowTs()
                    }
                }
            );
        }

        return res.json({ ok: true, user: username, tagId });
    } catch (err) {
        console.error("admin/revokeTag error:", err);
        return res.status(500).json({ error: "Error" });
    }
});

app.post("/admin/grantEffect", rateLimit(30, 60 * 1000), requireAdmin, async (req, res) => {
    const username = sanitizeUsername(req.body.user);
    const effectId = parseInt(req.body.effectId, 10);

    if (!isValidUsername(username)) {
        return res.status(400).json({ error: "Invalid user" });
    }

    if (!isValidEffectId(effectId) || effectId < LOCKED_EFFECT_START_ID) {
        return res.status(400).json({ error: "Invalid effectId" });
    }

    try {
        await ensurePlayerExists(username);

        await playersCollection.updateOne(
            { name: username },
            {
                $addToSet: { ownedEffects: effectId },
                $set: { updatedAt: nowTs() }
            }
        );

        return res.json({ ok: true, user: username, effectId });
    } catch (err) {
        console.error("admin/grantEffect error:", err);
        return res.status(500).json({ error: "Error" });
    }
});

app.post("/admin/revokeEffect", rateLimit(30, 60 * 1000), requireAdmin, async (req, res) => {
    const username = sanitizeUsername(req.body.user);
    const effectId = parseInt(req.body.effectId, 10);

    if (!isValidUsername(username)) {
        return res.status(400).json({ error: "Invalid user" });
    }

    if (!isValidEffectId(effectId) || effectId < LOCKED_EFFECT_START_ID) {
        return res.status(400).json({ error: "Invalid effectId" });
    }

    try {
        await playersCollection.updateOne(
            { name: username },
            {
                $pull: { ownedEffects: effectId },
                $set: { updatedAt: nowTs() }
            }
        );

        const playerDoc = await playersCollection.findOne(
            { name: username },
            { projection: { _id: 0, effectId: 1 } }
        );

        if (playerDoc && parseInt(playerDoc.effectId, 10) === effectId) {
            await playersCollection.updateOne(
                { name: username },
                {
                    $set: {
                        effectId: DEFAULT_EFFECT_ID,
                        updatedAt: nowTs()
                    }
                }
            );
        }

        return res.json({ ok: true, user: username, effectId });
    } catch (err) {
        console.error("admin/revokeEffect error:", err);
        return res.status(500).json({ error: "Error" });
    }
});

app.post("/admin/grantShell", rateLimit(30, 60 * 1000), requireAdmin, async (req, res) => {
    const username = sanitizeUsername(req.body.user);
    const shellId = parseInt(req.body.shellId, 10);

    if (!isValidUsername(username)) {
        return res.status(400).json({ error: "Invalid user" });
    }

    if (!isValidShellOverride(shellId)) {
        return res.status(400).json({ error: "Invalid shellId" });
    }

    try {
        await ensurePlayerExists(username);

        await playersCollection.updateOne(
            { name: username },
            {
                $addToSet: { ownedShells: shellId },
                $set: { updatedAt: nowTs() }
            }
        );

        return res.json({
            ok: true,
            user: username,
            shellId
        });
    } catch (err) {
        console.error("admin/grantShell error:", err);
        return res.status(500).json({ error: "Error" });
    }
});

app.post("/admin/revokeShell", rateLimit(30, 60 * 1000), requireAdmin, async (req, res) => {
    const username = sanitizeUsername(req.body.user);
    const shellId = parseInt(req.body.shellId, 10);

    if (!isValidUsername(username)) {
        return res.status(400).json({ error: "Invalid user" });
    }

    if (!isValidShellOverride(shellId)) {
        return res.status(400).json({ error: "Invalid shellId" });
    }

    try {
        await playersCollection.updateOne(
            { name: username },
            {
                $pull: { ownedShells: shellId },
                $set: { updatedAt: nowTs() }
            }
        );

        const playerDoc = await playersCollection.findOne(
            { name: username },
            {
                projection: {
                    _id: 0,
                    shellOverride: 1
                }
            }
        );

        if (playerDoc && parseInt(playerDoc.shellOverride, 10) === shellId) {
            await playersCollection.updateOne(
                { name: username },
                {
                    $set: {
                        shellOverride: DEFAULT_SHELL_ID,
                        updatedAt: nowTs()
                    }
                }
            );
        }

        return res.json({
            ok: true,
            user: username,
            shellId
        });
    } catch (err) {
        console.error("admin/revokeShell error:", err);
        return res.status(500).json({ error: "Error" });
    }
});
