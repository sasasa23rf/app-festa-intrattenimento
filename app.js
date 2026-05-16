const API_URL = '/api';
let currentPlayer = null;
let currentScannedPlayerId = null;

// Initialization
window.onload = () => {
    const savedPlayerId = localStorage.getItem('festa_player_id');
    if (savedPlayerId) {
        loadPlayer(savedPlayerId);
    } else {
        showView('view-login');
    }
};

// Navigation
function showView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
}

// API Calls & Logic
async function register() {
    const nameInput = document.getElementById('playerName');
    const name = nameInput.value.trim();
    
    if (!name) {
        alert('Per favore, inserisci un nome!');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        
        const data = await response.json();
        if (data.error) {
            alert(data.error);
            return;
        }

        localStorage.setItem('festa_player_id', data.id);
        currentPlayer = data;
        updateDashboard();
        showView('view-dashboard');
    } catch (error) {
        console.error('Error:', error);
        alert('Errore durante la registrazione');
    }
}

async function loadPlayer(id) {
    try {
        const response = await fetch(`${API_URL}/player/${id}`);
        if (!response.ok) {
            localStorage.removeItem('festa_player_id');
            showView('view-login');
            return;
        }
        
        currentPlayer = await response.json();
        updateDashboard();
        showView('view-dashboard');
    } catch (error) {
        console.error('Error:', error);
        showView('view-login');
    }
}

function updateDashboard() {
    document.getElementById('welcomeMessage').innerText = currentPlayer.name;
    document.getElementById('myCardValue').innerText = currentPlayer.myCard;
    document.getElementById('totalScore').innerText = currentPlayer.score;
    document.getElementById('scansLeft').innerText = currentPlayer.scansLeft;
    document.getElementById('cancelAvailable').innerText = currentPlayer.cancelAvailable > 0 ? 'Sì' : 'No';
    
    const shortCodeEl = document.getElementById('myShortCode');
    if (shortCodeEl) {
        shortCodeEl.innerText = currentPlayer.shortCode || '-';
    }

    // Update collected cards list
    const list = document.getElementById('collectedCardsList');
    const container = document.getElementById('collectedCardsContainer');
    list.innerHTML = '';
    if (currentPlayer.collectedCards && currentPlayer.collectedCards.length > 0) {
        container.style.display = 'block';
        currentPlayer.collectedCards.forEach((card, index) => {
            const li = document.createElement('li');
            li.innerHTML = `<span>Carta ${index + 1}</span> <strong style="color: var(--primary);">+${card.card_value}</strong>`;
            list.appendChild(li);
        });
    } else {
        container.style.display = 'none';
    }
}

function showDashboard() {
    showView('view-dashboard');
}

async function submitManualCode() {
    const input = document.getElementById('manualCodeInput');
    const code = input.value.trim().toUpperCase();
    
    if (code.length !== 6) {
        alert('Il codice deve essere di 6 caratteri alfanumerici!');
        return;
    }
    
    if (currentPlayer.scansLeft <= 0) {
        alert('Hai esaurito le mosse disponibili!');
        return;
    }
    
    await processScannedCode(code);
    input.value = ''; // clear the input
}

async function processScannedCode(scannedText) {
    if (scannedText === currentPlayer.id || scannedText === currentPlayer.shortCode) {
        alert("Non puoi inserire il tuo stesso codice!");
        return;
    }

    try {
        const response = await fetch(`${API_URL}/preview/${scannedText}`);
        const data = await response.json();
        
        if (data.error) {
            alert(data.error);
            return;
        }

        currentScannedPlayerId = data.id; 
        document.getElementById('scannedPlayerName').innerText = data.name;
        document.getElementById('scannedCardValue').innerText = data.cardValue;
        document.getElementById('btnAcceptValue').innerText = data.cardValue;
        
        const btnCancel = document.getElementById('btnCancelCard');
        if (currentPlayer.cancelAvailable > 0) {
            btnCancel.style.display = 'block';
            btnCancel.disabled = false;
        } else {
            btnCancel.style.display = 'none';
        }

        showView('view-scan-result');
    } catch (error) {
        console.error('Error:', error);
        alert('Errore durante la ricerca del codice');
    }
}

async function acceptCard() {
    await processScan('accept');
}

async function cancelCard() {
    if (confirm('Sei sicuro di voler usare la tua unica carta "Annulla"? Non potrai più usarla in seguito!')) {
        await processScan('cancel');
    }
}

async function processScan(action) {
    try {
        const response = await fetch(`${API_URL}/scan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                playerId: currentPlayer.id,
                scannedId: currentScannedPlayerId,
                action: action
            })
        });
        
        const data = await response.json();
        
        if (data.error) {
            alert(data.error);
        } else {
            if (action === 'cancel') {
                alert('Carta annullata con successo!');
            } else {
                alert('Carta aggiunta con successo!');
            }
        }
        
        // Go back and reload player data
        showView('view-dashboard');
        loadPlayer(currentPlayer.id);
        
    } catch (error) {
        console.error('Error:', error);
        alert('Errore di connessione');
        showView('view-dashboard');
    }
}

// Leaderboard functionality
let previousView = 'view-login';

async function showLeaderboard() {
    // Save current view to go back
    document.querySelectorAll('.view').forEach(v => {
        if (v.classList.contains('active')) {
            previousView = v.id;
        }
    });

    try {
        const response = await fetch(`${API_URL}/leaderboard`);
        const data = await response.json();
        
        const list = document.getElementById('leaderboardList');
        list.innerHTML = '';
        
        // Separate ranked (>= 2 cards) and unranked players
        const rankedPlayers = [];
        const unrankedPlayers = [];
        
        data.forEach(player => {
            if (player.cardsCollected >= 2) {
                rankedPlayers.push(player);
            } else {
                unrankedPlayers.push(player);
            }
        });
        
        // Sort ranked players by score (already sorted from DB, but just in case)
        rankedPlayers.sort((a, b) => b.score - a.score);
        
        // Render ranked players
        rankedPlayers.forEach((player, index) => {
            const li = document.createElement('li');
            
            let medal = '';
            if (index === 0) medal = '🥇 ';
            else if (index === 1) medal = '🥈 ';
            else if (index === 2) medal = '🥉 ';
            else medal = `${index + 1}. `;
            
            li.innerHTML = `
                <span>${medal}${player.name}</span>
                <strong>${player.score} pt</strong>
            `;
            list.appendChild(li);
        });
        
        // Render unranked players at the bottom
        if (unrankedPlayers.length > 0) {
            if (rankedPlayers.length > 0) {
                const separator = document.createElement('li');
                separator.style.background = 'transparent';
                separator.style.boxShadow = 'none';
                separator.style.justifyContent = 'center';
                separator.style.color = 'var(--text-muted)';
                separator.style.fontSize = '0.9rem';
                separator.innerHTML = '<em>In attesa di qualificarsi...</em>';
                list.appendChild(separator);
            }
            
            unrankedPlayers.forEach(player => {
                const li = document.createElement('li');
                li.style.opacity = '0.7';
                li.innerHTML = `
                    <span>- ${player.name}</span>
                    <strong style="color: var(--text-muted); font-size: 0.9rem; font-weight: normal;">(Nasconde il punteggio)</strong>
                `;
                list.appendChild(li);
            });
        }
        
        if (data.length === 0) {
            list.innerHTML = '<li style="justify-content: center; color: var(--text-muted);">Nessun giocatore registrato</li>';
        }
        
        showView('view-leaderboard');
    } catch (error) {
        console.error('Error:', error);
        alert('Errore durante il caricamento della classifica');
    }
}

function goBackFromLeaderboard() {
    showView(previousView);
}
