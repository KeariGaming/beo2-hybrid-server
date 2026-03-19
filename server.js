const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { MongoClient } = require("mongodb");

const app = express();

app.use(cors({
    origin: [
        "http://127.0.0.1:5500",
        "http://localhost:5500"
    ],
    methods: ["GET", "POST", "OPTIONS"]
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const uri = process.env.MONGO_URI;
const ADMIN_KEY = process.env.ADMIN_KEY;

const client = new MongoClient(uri);

let playersCollection;
let sessionsCollection;

const SESSION_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours
const ALLOWED_SHELL_MIN = 1;
const ALLOWED_SHELL_MAX = 10000;

// ID -> value maps
const TAG_ID_MAP = {
    0: "",
    1: "[DEV]",
    2: "[VIP]",
    3: "[MOD]",
    4: "[OG]"
};

const EFFECT_ID_MAP = {
    0: "",
    1: "rainbow"
};

function makeToken() {
    return crypto.randomBytes(32).toString("hex");
}

function isValidShellOverride(value) {
    return Number.isInteger(value) && value >= ALLOWED_SHELL_MIN && value <= ALLOWED_SHELL_MAX;
}

function getTagValueFromId(id) {
    return Object.prototype.hasOwnProperty.call(TAG_ID_MAP, id) ? TAG_ID_MAP[id] : null;
}

function getEffectValueFromId(id) {
    return Object.prototype.hasOwnProperty.call(EFFECT_ID_MAP, id) ? EFFECT_ID_MAP[id] : null;
}

async function cleanupExpiredSessions() {
    const now = Date.now();
    await sessionsCollection.deleteMany({ expiresAt: { $lte: now } });
}

async function getValidSession(token) {
    await cleanupExpiredSessions();

    if (!token) {
        return null;
    }

    return await sessionsCollection.findOne({ token });
}

async function start() {
    try {
        await client.connect();

        const db = client.db("beo2");
        playersCollection = db.collection("players");
        sessionsCollection = db.collection("sessions");

        await sessionsCollection.createIndex({ token: 1 }, { unique: true });
        await sessionsCollection.createIndex({ expiresAt: 1 });

        console.log("MongoDB connected");

        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => {
            console.log("Running on port", PORT);
        });
    } catch (err) {
        console.error("MongoDB connection error:", err);
    }
}

start();

app.get("/register", async (req, res) => {
    const username = req.query.username?.toLowerCase();
    if (!username) return res.send("No username");

    try {
        const existing = await playersCollection.findOne({ name: username });

        if (!existing) {
            await playersCollection.insertOne({
                name: username,
                connectUserId: "",
                tag: "",
                effect: "",
                color: "",
                shellOverride: 0
            });
            console.log("Registered:", username);
        }

        res.send("OK");
    } catch (err) {
        console.error(err);
        res.status(500).send("Error");
    }
});

app.get("/registerSession", async (req, res) => {
    const username = req.query.username?.toLowerCase();
    const connectUserId = req.query.connectUserId;

    if (!username || !connectUserId) {
        return res.status(400).json({ error: "Missing username or connectUserId" });
    }

    try {
        await cleanupExpiredSessions();

        await playersCollection.updateOne(
            { name: username },
            {
                $setOnInsert: {
                    name: username,
                    tag: "",
                    effect: "",
                    color: "",
                    shellOverride: 0
                },
                $set: {
                    connectUserId: connectUserId
                }
            },
            { upsert: true }
        );

        const token = makeToken();
        const expiresAt = Date.now() + SESSION_TTL_MS;

        await sessionsCollection.deleteMany({
            $or: [
                { name: username },
                { connectUserId: connectUserId }
            ]
        });

        await sessionsCollection.insertOne({
            token,
            name: username,
            connectUserId,
            expiresAt
        });

        res.json({
            ok: true,
            token,
            expiresAt
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error" });
    }
});

app.get("/setMyShell", async (req, res) => {
    const token = req.query.token;
    const shellOverride = parseInt(req.query.shellOverride ?? "0", 10);

    if (!token) {
        return res.status(400).json({ error: "Missing token" });
    }

    if (!isValidShellOverride(shellOverride)) {
        return res.status(400).json({ error: "Invalid shellOverride" });
    }

    try {
        const session = await getValidSession(token);

        if (!session) {
            return res.status(403).json({ error: "Invalid or expired session" });
        }

        await playersCollection.updateOne(
            {
                name: session.name,
                connectUserId: session.connectUserId
            },
            {
                $set: {
                    shellOverride: shellOverride
                }
            }
        );

        res.json({
            ok: true,
            name: session.name,
            shellOverride
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error" });
    }
});

app.get("/setMyTag", async (req, res) => {
    const token = req.query.token;
    const tagId = parseInt(req.query.tagId ?? "0", 10);
    const tagValue = getTagValueFromId(tagId);

    if (!token) {
        return res.status(400).json({ error: "Missing token" });
    }

    if (tagValue === null) {
        return res.status(400).json({ error: "Invalid tagId" });
    }

    try {
        const session = await getValidSession(token);

        if (!session) {
            return res.status(403).json({ error: "Invalid or expired session" });
        }

        await playersCollection.updateOne(
            {
                name: session.name,
                connectUserId: session.connectUserId
            },
            {
                $set: {
                    tag: tagValue
                }
            }
        );

        res.json({
            ok: true,
            name: session.name,
            tagId,
            tag: tagValue
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error" });
    }
});

app.get("/setMyEffect", async (req, res) => {
    const token = req.query.token;
    const effectId = parseInt(req.query.effectId ?? "0", 10);
    const effectValue = getEffectValueFromId(effectId);

    if (!token) {
        return res.status(400).json({ error: "Missing token" });
    }

    if (effectValue === null) {
        return res.status(400).json({ error: "Invalid effectId" });
    }

    try {
        const session = await getValidSession(token);

        if (!session) {
            return res.status(403).json({ error: "Invalid or expired session" });
        }

        await playersCollection.updateOne(
            {
                name: session.name,
                connectUserId: session.connectUserId
            },
            {
                $set: {
                    effect: effectValue
                }
            }
        );

        res.json({
            ok: true,
            name: session.name,
            effectId,
            effect: effectValue
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error" });
    }
});

app.get("/players", async (req, res) => {
    try {
        const players = await playersCollection.find().toArray();
        res.json(players);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error");
    }
});

app.get("/getPlayer", async (req, res) => {
    const username = req.query.username?.toLowerCase();
    if (!username) return res.send("No username");

    try {
        const player = await playersCollection.findOne({ name: username });

        if (!player) {
            return res.json({});
        }

        res.json({
            tag: player.tag || "",
            effect: player.effect || "",
            color: player.color || "",
            shellOverride: player.shellOverride || 0
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error");
    }
});

app.get("/setTag", async (req, res) => {
    const key = req.query.key;
    if (key !== ADMIN_KEY) {
        return res.status(403).send("Unauthorized");
    }

    const username = req.query.user?.toLowerCase();
    const tag = req.query.tag ?? "";
    const effect = req.query.effect ?? "";
    const color = req.query.color ?? "";
    const shellOverride = parseInt(req.query.shellOverride ?? "0", 10) || 0;

    if (!username) return res.send("Missing user");

    try {
        await playersCollection.updateOne(
            { name: username },
            {
                $set: {
                    tag,
                    effect,
                    color,
                    shellOverride
                }
            },
            { upsert: true }
        );

        res.send("Tag/effect/shell updated");
    } catch (err) {
        console.error(err);
        res.status(500).send("Error");
    }
});

app.get("/crossdomain.xml", (req, res) => {
    res.type("application/xml");
    res.send(`<?xml version="1.0"?>
<cross-domain-policy>
   <allow-access-from domain="*" />
</cross-domain-policy>`);
});

app.get("/", (req, res) => {
    res.send("Server running");
});
