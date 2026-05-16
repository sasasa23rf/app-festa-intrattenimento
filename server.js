const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;

// Check if index.html exists during server startup
const indexPath = path.join(__dirname, 'public', 'index.html');
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

// Add shortCode column to existing database if it doesn't exist
try {
    db.prepare(`ALTER TABLE players ADD COLUMN shortCode TEXT`).run();
} catch (err) {
    // Ignore error if column already exists
}

db.prepare(`CREATE TABLE IF NOT EXISTS collected_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT NOT NULL,
    scanned_player_id TEXT NOT NULL,
    card_value INTEGER NOT NULL
)`).run();

// Helper function to calculate score
const updateScore = (playerId) => {
    return new Promise((resolve, reject) => {
        db.get('SELECT myCard FROM players WHERE id = ?', [playerId], (err, player) => {
            if (err) return reject(err);
            if (!player) return reject(new Error('Player not found'));
            
            db.all('SELECT card_value FROM collected_cards WHERE player_id = ?', [playerId], (err, rows) => {
                if (err) return reject(err);
                
                let totalScore = player.myCard;
                rows.forEach(row => {
                    totalScore += row.card_value;
                });
                
                db.run('UPDATE players SET score = ? WHERE id = ?', [totalScore, playerId], (err) => {
                    if (err) return reject(err);
                    resolve(totalScore);
                });
            });
        });
    });
};

// API: Register a new player
app.post('/api/register', (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const id = uuidv4();
    const myCard = Math.floor(Math.random() * 10) + 1; // 1 to 10
    
    // Generate a random 6-character alphanumeric code
    const shortCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    db.run('INSERT INTO players (id, name, myCard, score, shortCode) VALUES (?, ?, ?, ?, ?)', [id, name, myCard, myCard, shortCode], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id, name, myCard, scansLeft: 3, cancelAvailable: 1, score: myCard, collectedCards: [], shortCode });
    });
});

// API: Get player info
app.get('/api/player/:id', (req, res) => {
    const { id } = req.params;
    db.get('SELECT * FROM players WHERE id = ?', [id], (err, player) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!player) return res.status(404).json({ error: 'Player not found' });

        db.all('SELECT scanned_player_id, card_value FROM collected_cards WHERE player_id = ?', [id], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            player.collectedCards = rows;
            res.json(player);
        });
    });
});

// API: Preview scanned player (to decide accept/cancel)
app.get('/api/preview/:scannedId', (req, res) => {
    const { scannedId } = req.params;
    db.get('SELECT id, name, myCard FROM players WHERE id = ? OR shortCode = ?', [scannedId, scannedId], (err, player) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!player) return res.status(404).json({ error: 'Player not found' });
        res.json({ id: player.id, name: player.name, cardValue: player.myCard });
    });
});

// API: Confirm scan (Accept or Cancel)
app.post('/api/scan', (req, res) => {
    const { playerId, scannedId, action } = req.body; // action: 'accept' or 'cancel'

    if (playerId === scannedId) {
        return res.status(400).json({ error: 'Non puoi scansionare te stesso!' });
    }

    db.get('SELECT * FROM players WHERE id = ?', [playerId], (err, player) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!player) return res.status(404).json({ error: 'Player not found' });

        if (action === 'cancel') {
            if (player.cancelAvailable <= 0) {
                return res.status(400).json({ error: 'Carta annulla non disponibile' });
            }
            db.run('UPDATE players SET cancelAvailable = 0 WHERE id = ?', [playerId], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                return res.json({ success: true, message: 'Carta annullata!' });
            });
        } else if (action === 'accept') {
            if (player.scansLeft <= 0) {
                return res.status(400).json({ error: 'Non hai più scansioni disponibili' });
            }

            // Check if already scanned this player
            db.get('SELECT * FROM collected_cards WHERE player_id = ? AND scanned_player_id = ?', [playerId, scannedId], (err, existing) => {
                if (err) return res.status(500).json({ error: err.message });
                if (existing) return res.status(400).json({ error: 'Hai già scansionato questo giocatore!' });

                db.get('SELECT myCard FROM players WHERE id = ?', [scannedId], (err, scannedPlayer) => {
                    if (err) return res.status(500).json({ error: err.message });
                    if (!scannedPlayer) return res.status(404).json({ error: 'Scanned player not found' });

                    db.run('INSERT INTO collected_cards (player_id, scanned_player_id, card_value) VALUES (?, ?, ?)', 
                        [playerId, scannedId, scannedPlayer.myCard], (err) => {
                        if (err) return res.status(500).json({ error: err.message });

                        db.run('UPDATE players SET scansLeft = scansLeft - 1 WHERE id = ?', [playerId], async (err) => {
                            if (err) return res.status(500).json({ error: err.message });
                            
                            try {
                                const newScore = await updateScore(playerId);
                                res.json({ success: true, newScore });
                            } catch (error) {
                                res.status(500).json({ error: error.message });
                            }
                        });
                    });
                });
            });
        } else {
            res.status(400).json({ error: 'Azione non valida' });
        }
    });
});

// API: Leaderboard
app.get('/api/leaderboard', (req, res) => {
    // We get all players and their scan counts
    const query = `
        SELECT 
            p.name, 
            p.score, 
            (3 - p.scansLeft) as cardsCollected 
        FROM players p 
        ORDER BY score DESC
    `;
    
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
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
