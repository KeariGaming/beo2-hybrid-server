const express = require("express");
const cors = require("cors");
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
let collection;

async function start() {
    try {
        await client.connect();

        const db = client.db("beo2");
        collection = db.collection("players");

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
        const existing = await collection.findOne({ name: username });

        if (!existing) {
            await collection.insertOne({
                name: username,
                tag: "",
                effect: ""
            });
            console.log("Registered:", username);
        }

        res.send("OK");
    } catch (err) {
        console.error(err);
        res.status(500).send("Error");
    }
});

app.get("/players", async (req, res) => {
    try {
        const players = await collection.find().toArray();
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
        const player = await collection.findOne({ name: username });

        if (!player) {
            return res.json({});
        }

        res.json({
            tag: player.tag || "",
            effect: player.effect || ""
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

    if (!username) return res.send("Missing user");

    try {
        await collection.updateOne(
            { name: username },
            {
                $set: {
                    tag: tag,
                    effect: effect
                }
            },
            { upsert: true }
        );

        res.send("Tag/effect updated");
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
