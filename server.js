const express = require("express");
const { MongoClient } = require("mongodb");

const app = express();
app.use(express.json());

const uri = process.env.MONGO_URI;
const client = new MongoClient(uri);

let collection;

// Start server ONLY after DB connects
async function start() {
    try {
        await client.connect();

        const db = client.db("beo2");
        collection = db.collection("players");

        console.log("MongoDB connected");

        // 🚀 START SERVER HERE (important)
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => {
            console.log("Running on port", PORT);
        });

    } catch (err) {
        console.error("MongoDB connection error:", err);
    }
}

start();

// Register player
app.get("/register", async (req, res) => {
    const username = req.query.username?.toLowerCase();
    if (!username) return res.send("No username");

    try {
        const existing = await collection.findOne({ name: username });

        if (!existing) {
            await collection.insertOne({
                name: username,
                tag: "[PLAYER]"
            });
            console.log("Registered:", username);
        }

        res.send("OK");
    } catch (err) {
        console.error(err);
        res.status(500).send("Error");
    }
});

// Get all players
app.get("/players", async (req, res) => {
    try {
        const players = await collection.find().toArray();
        res.json(players);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error");
    }
});

// Change tag
const ADMIN_KEY = process.env.ADMIN_KEY;

app.get("/setTag", async (req, res) => {
    const key = req.query.key;

    if (key !== ADMIN_KEY) {
        return res.status(403).send("Unauthorized");
    }

    const username = req.query.user?.toLowerCase();
    const tag = req.query.tag;

    if (!username || !tag) return res.send("Missing params");

    try {
        await collection.updateOne(
            { name: username },
            { $set: { tag: tag } }
        );

        res.send("Tag updated");
    } catch (err) {
        console.error(err);
        res.status(500).send("Error");
    }
});

// Flash crossdomain
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
