const express = require("express");
const app = express();
const fs require("fs");

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

let players = [];

// Load players from file
function loadPlayers() {
    try {
        const data = fs.readFileSync("players.json");
        players = JSON.parse(data);
    } catch (err) {
        players = [];
    }
}

// Save players to file
function savePlayers() {
    fs.writeFileSync("players.json", JSON.stringify(players, null, 2));
}

// Load on startup
loadPlayers();

// Register player
app.post("/register", (req, res) => {
    const username = req.body.username;

    if (username && !players.includes(username)) {
        players.push(username);
        console.log("Registered:", username);
    }

    res.send("OK");
});

app.get("/register", (req, res) => {
    const username = req.query.username?.toLowerCase();

    if (!username) return res.send("No username");

    let existing = players.find(p => p.name === username);

    if (!existing) {
        players.push({ name: username, tag: "[PLAYER]" }); // default tag
        savePlayers();
        console.log("Registered:", username);
    }

    res.send("OK");
});

// Get all players
app.get("/players", (req, res) => {
    res.json(players);
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("Running on port", PORT);
});
