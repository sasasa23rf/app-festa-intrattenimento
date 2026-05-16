const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;

// Check if index.html exists during server startup
const indexPath = path.join(__dirname, 'index.html');
if (!fs.existsSync(indexPath)) {
    console.error(`Error: index.html not found at ${indexPath}`);
} else {
    console.log(`index.html found at ${indexPath}`);
}

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Initialize SQLite database
const db = new Database('game.db');

db.prepare(`CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    myCard INTEGER NOT NULL,
    scansLeft INTEGER DEFAULT 3,
    cancelAvailable INTEGER DEFAULT 1,
    score INTEGER DEFAULT 0,
    shortCode TEXT
)`).run();

// Add shortCode and clue columns to existing database if it doesn't exist
try {
    db.prepare(`ALTER TABLE players ADD COLUMN shortCode TEXT`).run();
} catch (err) {}

try {
    db.prepare(`ALTER TABLE players ADD COLUMN clue TEXT`).run();
} catch (err) {}

db.prepare(`CREATE TABLE IF NOT EXISTS collected_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT NOT NULL,
    scanned_player_id TEXT NOT NULL,
    card_value INTEGER NOT NULL
)`).run();

// Helper function to calculate score
const updateScore = (playerId) => {
    const player = db.prepare('SELECT myCard FROM players WHERE id = ?').get(playerId);
    if (!player) throw new Error('Player not found');
    
    const rows = db.prepare('SELECT card_value FROM collected_cards WHERE player_id = ?').all(playerId);
    
    let totalScore = player.myCard;
    rows.forEach(row => {
        totalScore += row.card_value;
    });
    
    db.prepare('UPDATE players SET score = ? WHERE id = ?').run(totalScore, playerId);
    return totalScore;
};

const pendingScans = new Map();

function forceAccept(playerId, scannedId) {
    try {
        const existing = db.prepare('SELECT * FROM collected_cards WHERE player_id = ? AND scanned_player_id = ?').get(playerId, scannedId);
        if (existing) return;
        
        const player = db.prepare('SELECT * FROM players WHERE id = ?').get(playerId);
        if (!player || player.scansLeft <= 0) return;
        
        const scannedPlayer = db.prepare('SELECT myCard FROM players WHERE id = ?').get(scannedId);
        if (!scannedPlayer) return;
        
        db.prepare('INSERT INTO collected_cards (player_id, scanned_player_id, card_value) VALUES (?, ?, ?)').run(playerId, scannedId, scannedPlayer.myCard);
        db.prepare('UPDATE players SET scansLeft = scansLeft - 1 WHERE id = ?').run(playerId);
        updateScore(playerId);
    } catch(err) {
        console.error("Force accept error:", err);
    }
}

let registrationEnabled = false;

// API: Register a new player
app.post('/api/register', (req, res) => {
    if (!registrationEnabled) {
        return res.status(403).json({ error: 'Le iscrizioni al gioco sono attualmente chiuse. Attendi che l\'admin le apra.' });
    }
    try {
        let { name, myCard, clue } = req.body;
        if (!name) return res.status(400).json({ error: 'Name is required' });

        const id = uuidv4();
        
        // Use provided myCard, or generate a random one if invalid
        myCard = parseInt(myCard);
        if (isNaN(myCard) || myCard < 1 || myCard > 10) {
            myCard = Math.floor(Math.random() * 10) + 1; // 1 to 10
        }
        
        // Generate a random 6-character alphanumeric code
        const shortCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        const safeClue = clue ? clue.substring(0, 100) : '';

        db.prepare('INSERT INTO players (id, name, myCard, score, shortCode, clue) VALUES (?, ?, ?, ?, ?, ?)').run(id, name, myCard, myCard, shortCode, safeClue);
        
        checkAndManageKeepAlive(); // Check if we need to start pinging

        res.json({ id, name, myCard, scansLeft: 3, cancelAvailable: 1, score: myCard, collectedCards: [], shortCode, clue: safeClue });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Get player info
app.get('/api/player/:id', (req, res) => {
    try {
        const { id } = req.params;
        const player = db.prepare('SELECT * FROM players WHERE id = ?').get(id);
        
        if (!player) return res.status(404).json({ error: 'Player not found' });

        const rows = db.prepare('SELECT scanned_player_id, card_value FROM collected_cards WHERE player_id = ?').all(id);
        player.collectedCards = rows;
        res.json(player);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Preview scanned player (to decide accept/cancel)
app.get('/api/preview/:scannedId', (req, res) => {
    try {
        const { scannedId } = req.params;
        const { playerId } = req.query;
        if (!playerId) return res.status(400).json({ error: 'playerId required' });

        const scannedPlayer = db.prepare('SELECT id, name, myCard FROM players WHERE id = ? OR shortCode = ?').get(scannedId, scannedId);
        if (!scannedPlayer) return res.status(404).json({ error: 'Codice non trovato' });

        if (playerId === scannedPlayer.id) return res.status(400).json({ error: 'Non puoi scansionare te stesso!' });

        const player = db.prepare('SELECT * FROM players WHERE id = ?').get(playerId);
        if (!player) return res.status(404).json({ error: 'Player non trovato' });
        if (player.scansLeft <= 0) return res.status(400).json({ error: 'Non hai più scansioni disponibili' });

        const existing = db.prepare('SELECT * FROM collected_cards WHERE player_id = ? AND scanned_player_id = ?').get(playerId, scannedPlayer.id);
        if (existing) return res.status(400).json({ error: 'Hai già scansionato questo giocatore!' });

        if (pendingScans.has(playerId)) clearTimeout(pendingScans.get(playerId));
        
        const timeoutDelay = player.cancelAvailable > 0 ? 7000 : 5000;
        const timer = setTimeout(() => {
            forceAccept(playerId, scannedPlayer.id);
            pendingScans.delete(playerId);
        }, timeoutDelay);
        pendingScans.set(playerId, timer);

        res.json({ id: scannedPlayer.id, name: scannedPlayer.name, cardValue: scannedPlayer.myCard, cancelAvailable: player.cancelAvailable });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Confirm scan (Accept or Cancel)
app.post('/api/scan', (req, res) => {
    try {
        const { playerId, scannedId, action } = req.body; // action: 'accept' or 'cancel'

        if (pendingScans.has(playerId)) {
            clearTimeout(pendingScans.get(playerId));
            pendingScans.delete(playerId);
        }

        if (playerId === scannedId) {
            return res.status(400).json({ error: 'Non puoi scansionare te stesso!' });
        }

        const player = db.prepare('SELECT * FROM players WHERE id = ?').get(playerId);
        if (!player) return res.status(404).json({ error: 'Player not found' });

        if (action === 'cancel') {
            if (player.cancelAvailable <= 0) {
                return res.status(400).json({ error: 'Carta annulla non disponibile' });
            }
            db.prepare('UPDATE players SET cancelAvailable = 0 WHERE id = ?').run(playerId);
            return res.json({ success: true, message: 'Carta annullata!' });
            
        } else if (action === 'accept') {
            if (player.scansLeft <= 0) {
                return res.status(400).json({ error: 'Non hai più scansioni disponibili' });
            }

            // Check if already scanned this player
            const existing = db.prepare('SELECT * FROM collected_cards WHERE player_id = ? AND scanned_player_id = ?').get(playerId, scannedId);
            if (existing) return res.status(400).json({ error: 'Hai già scansionato questo giocatore!' });

            const scannedPlayer = db.prepare('SELECT myCard FROM players WHERE id = ?').get(scannedId);
            if (!scannedPlayer) return res.status(404).json({ error: 'Scanned player not found' });

            db.prepare('INSERT INTO collected_cards (player_id, scanned_player_id, card_value) VALUES (?, ?, ?)').run(playerId, scannedId, scannedPlayer.myCard);
            db.prepare('UPDATE players SET scansLeft = scansLeft - 1 WHERE id = ?').run(playerId);
            
            const newScore = updateScore(playerId);
            res.json({ success: true, newScore });
            
        } else {
            res.status(400).json({ error: 'Azione non valida' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Leaderboard
app.get('/api/leaderboard', (req, res) => {
    try {
        const query = `
            SELECT 
                p.name, 
                p.score, 
                p.clue,
                (3 - p.scansLeft) as cardsCollected 
            FROM players p 
            WHERE LOWER(p.name) != 'rere'
            ORDER BY score DESC
        `;
        const rows = db.prepare(query).all();
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Game Status (Check if all players finished)
app.get('/api/game-status', (req, res) => {
    try {
        const row = db.prepare("SELECT COUNT(*) as totalPlayers, SUM(scansLeft) as totalScansLeft FROM players WHERE LOWER(name) != 'rere'").get();
        if (!row || row.totalPlayers === 0) {
            return res.json({ isOver: false });
        }
        
        if (row.totalScansLeft === 0) {
            // Game is over! Calculate winners
            const players = db.prepare("SELECT name, score FROM players WHERE LOWER(name) != 'rere' ORDER BY score DESC").all();
            
            const places = [];
            let currentScore = -1;
            let currentRank = 0;
            
            for (const p of players) {
                if (p.score !== currentScore) {
                    currentRank++;
                    if (currentRank > 3) break;
                    currentScore = p.score;
                    places.push({ rank: currentRank, score: p.score, winners: [p.name] });
                } else {
                    places[places.length - 1].winners.push(p.name);
                }
            }
            
            return res.json({ isOver: true, places });
        }
        
        res.json({ isOver: false });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Admin & Keep Alive ---
app.get('/api/admin/settings', (req, res) => {
    res.json({ registrationEnabled });
});

app.post('/api/admin/settings/registration', (req, res) => {
    const { password, enabled } = req.body;
    if (password !== '0825') return res.status(401).json({ error: 'Non autorizzato' });
    registrationEnabled = !!enabled;
    res.json({ success: true, registrationEnabled });
});
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`;
let keepAliveInterval = null;

function checkAndManageKeepAlive() {
    try {
        const row = db.prepare('SELECT COUNT(*) as count FROM players').get();
        if (row && row.count > 0) {
            if (!keepAliveInterval) {
                console.log("Starting keep-alive ping...");
                keepAliveInterval = setInterval(() => {
                    fetch(`${RENDER_URL}/api/ping`).catch(() => {});
                }, 60000);
            }
        } else {
            if (keepAliveInterval) {
                console.log("Stopping keep-alive ping...");
                clearInterval(keepAliveInterval);
                keepAliveInterval = null;
            }
        }
    } catch(err) {
        console.error("Keep-alive check error:", err);
    }
}

// Initial check on server start
checkAndManageKeepAlive();

app.get('/api/ping', (req, res) => res.send('pong'));

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.post('/api/admin/reset', (req, res) => {
    const { password } = req.body;
    if (password !== '0825') return res.status(403).json({ error: 'Password errata' });
    
    try {
        db.prepare('DELETE FROM players').run();
        db.prepare('DELETE FROM collected_cards').run();
        pendingScans.forEach(timer => clearTimeout(timer));
        pendingScans.clear();
        
        checkAndManageKeepAlive(); // will stop the ping since count is 0
        
        res.json({ success: true });
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

// Serve the index.html file for the root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});

// Log middleware to track requests
app.use((req, res, next) => {
    console.log(`Request received: ${req.method} ${req.url}`);
    next();
});
