const API_URL = '/api';
let currentPlayer = null;
let currentScannedPlayerId = null;
let autoAcceptInterval = null;

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
let pendingRegistrationName = '';
let rouletteInterval = null;

async function startRegistration() {
    const nameInput = document.getElementById('playerName');
    const name = nameInput.value.trim();

    if (!name) {
        alert('Per favore, inserisci un nome!');
        return;
    }

    pendingRegistrationName = name;
    showView('view-roulette');
    startRoulette();
}

function startRoulette() {
    const rValue = document.getElementById('rouletteValue');
    const btnStop = document.getElementById('btnStopRoulette');
    btnStop.disabled = false;
    btnStop.innerText = 'Ferma la Ruota!';
    
    let currentVal = 1;
    rouletteInterval = setInterval(() => {
        currentVal++;
        if (currentVal > 10) currentVal = 1;
        rValue.innerText = currentVal;
    }, 30); // 30ms is very fast, making it almost impossible to time accurately
}

async function stopRoulette() {
    if (rouletteInterval) clearInterval(rouletteInterval);
    
    document.getElementById('btnStopRoulette').style.display = 'none';
    document.getElementById('clueContainer').style.display = 'block';
}

async function finishRegistration() {
    const finalCard = parseInt(document.getElementById('rouletteValue').innerText);
    const clue = document.getElementById('playerClue').value.trim();
    
    try {
        const response = await fetch(`${API_URL}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: pendingRegistrationName, myCard: finalCard, clue: clue })
        });

        const data = await response.json();
        if (data.error) {
            alert(data.error);
            showView('view-login');
            return;
        }

        localStorage.setItem('festa_player_id', data.id);
        currentPlayer = data;
        
        setTimeout(() => {
            document.getElementById('clueContainer').style.display = 'none';
            startGameStatusPolling();
            updateDashboard();
            showView('view-dashboard');
        }, 1500);
    } catch (error) {
        console.error('Error:', error);
        alert('Errore durante la registrazione');
        showView('view-login');
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
        startGameStatusPolling();
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

    const fullCodeEl = document.getElementById('fullScreenCodeValue');
    if (fullCodeEl) {
        fullCodeEl.innerText = currentPlayer.shortCode || '-';
    }

    // Update Annulla card status
    const cancelCardEl = document.getElementById('miniCancelCard');
    const cancelCardText = document.getElementById('miniCancelCardText');
    if (currentPlayer.cancelAvailable > 0) {
        cancelCardEl.classList.remove('used');
        cancelCardText.innerHTML = 'Annulla<br>disponibile';
    } else {
        cancelCardEl.classList.add('used');
        cancelCardText.innerHTML = 'Annulla<br>usato';
    }

    // Update 3 collected cards
    for (let i = 1; i <= 3; i++) {
        const cardEl = document.getElementById(`miniCard${i}`);
        const valEl = document.getElementById(`miniCardValue${i}`);
        if (currentPlayer.collectedCards && currentPlayer.collectedCards[i - 1]) {
            cardEl.classList.add('filled');
            cardEl.classList.remove('empty-card');
            valEl.innerText = `+${currentPlayer.collectedCards[i - 1].card_value}`;
        } else {
            cardEl.classList.remove('filled');
            cardEl.classList.add('empty-card');
            valEl.innerText = '';
        }
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
        const response = await fetch(`${API_URL}/preview/${scannedText}?playerId=${currentPlayer.id}`);
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
        const btnAccept = document.getElementById('btnAcceptCard');
        const timerDiv = document.getElementById('autoAcceptTimer');
        const timerSpan = document.getElementById('timerCountdown');
        
        if (autoAcceptInterval) clearInterval(autoAcceptInterval);
        
        if (data.cancelAvailable > 0) {
            btnCancel.style.display = 'block';
            btnAccept.style.display = 'block';
            btnCancel.disabled = false;
            timerDiv.style.display = 'block';
            
            let timeLeft = 5;
            timerSpan.innerText = timeLeft;
            
            // Go back automatically after 5s if the user hasn't clicked anything
            autoAcceptInterval = setInterval(async () => {
                timeLeft--;
                timerSpan.innerText = timeLeft;
                if (timeLeft <= 0) {
                    clearInterval(autoAcceptInterval);
                    if (document.getElementById('view-scan-result').classList.contains('active')) {
                        // Automatically accept if time runs out
                        await processScan('accept', true);
                    }
                }
            }, 1000);
        } else {
            btnCancel.style.display = 'none';
            btnAccept.style.display = 'none';
            timerDiv.style.display = 'block';
            
            let timeLeft = 3;
            timerSpan.innerText = timeLeft;
            
            // Auto accept after 3s client side (server also auto-accepts, but client needs to go back)
            autoAcceptInterval = setInterval(async () => {
                timeLeft--;
                timerSpan.innerText = timeLeft;
                if (timeLeft <= 0) {
                    clearInterval(autoAcceptInterval);
                    if (document.getElementById('view-scan-result').classList.contains('active')) {
                        await processScan('accept', true);
                    }
                }
            }, 1000);
        }

        showView('view-scan-result');
    } catch (error) {
        console.error('Error:', error);
        alert('Errore durante la ricerca del codice');
    }
}

async function acceptCard() {
    if (autoAcceptInterval) clearInterval(autoAcceptInterval);
    await processScan('accept', true); // Silent accept
}

async function cancelCard() {
    if (autoAcceptInterval) clearInterval(autoAcceptInterval);
    await processScan('cancel', true);
}

async function processScan(action, silent = false) {
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

        if (!silent) {
            if (data.error) {
                alert(data.error);
            } else {
                if (action === 'cancel') {
                    alert('Carta annullata con successo!');
                } else {
                    alert('Carta aggiunta con successo!');
                }
            }
        }

        // Go back and reload player data
        showView('view-dashboard');
        loadPlayer(currentPlayer.id);

    } catch (error) {
        console.error('Error:', error);
        if (!silent) alert('Errore di connessione');
        showView('view-dashboard');
    }
}

// Modal functions
function showMyCode() {
    document.getElementById('fullScreenCodeOverlay').style.display = 'flex';
}

function hideMyCode() {
    document.getElementById('fullScreenCodeOverlay').style.display = 'none';
}

// Leaderboard functionality
let previousView = 'view-login';
let leaderboardInterval = null;

async function fetchAndRenderLeaderboard() {
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
                <div style="display: flex; flex-direction: column;">
                    <span>${medal}${player.name}</span>
                    ${player.clue ? `<span style="font-size: 0.8rem; color: var(--text-muted); font-weight: normal; margin-top: 4px;">Indizio: ${player.clue}</span>` : ''}
                </div>
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
                    <div style="display: flex; flex-direction: column;">
                        <span>- ${player.name}</span>
                        ${player.clue ? `<span style="font-size: 0.8rem; color: var(--text-muted); font-weight: normal; margin-top: 4px;">Indizio: ${player.clue}</span>` : ''}
                    </div>
                    <strong style="color: var(--text-muted); font-size: 0.9rem; font-weight: normal;">(Nasconde il punteggio)</strong>
                `;
                list.appendChild(li);
            });
        }

        if (data.length === 0) {
            list.innerHTML = '<li style="justify-content: center; color: var(--text-muted);">Nessun giocatore registrato</li>';
        }
    } catch (error) {
        console.error('Error fetching leaderboard:', error);
    }
}

async function showLeaderboard() {
    // Save current view to go back
    document.querySelectorAll('.view').forEach(v => {
        if (v.classList.contains('active') && v.id !== 'view-leaderboard') {
            previousView = v.id;
        }
    });

    await fetchAndRenderLeaderboard();
    showView('view-leaderboard');

    if (leaderboardInterval) clearInterval(leaderboardInterval);
    leaderboardInterval = setInterval(fetchAndRenderLeaderboard, 1000);
}

function goBackFromLeaderboard() {
    if (leaderboardInterval) clearInterval(leaderboardInterval);
    showView(previousView);
}

// Game Status Polling
let gameStatusInterval = null;

function startGameStatusPolling() {
    if (gameStatusInterval) return;
    
    gameStatusInterval = setInterval(async () => {
        try {
            const res = await fetch(`${API_URL}/game-status`);
            const data = await res.json();
            
            if (data.isOver) {
                clearInterval(gameStatusInterval);
                showGameOver(data.places);
            }
        } catch (e) {
            console.error('Status check error:', e);
        }
    }, 3000); // Check every 3 seconds
}

function showGameOver(places) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-game-over').classList.add('active');
    
    document.getElementById('fullScreenCodeOverlay').style.display = 'none';
    
    const container = document.getElementById('podiumContainer');
    container.innerHTML = '';
    
    places.forEach(place => {
        let medal = '';
        let color = '';
        let bgColor = '';
        if (place.rank === 1) { medal = '🥇 1° POSTO'; color = '#fbbf24'; bgColor = 'rgba(251, 191, 36, 0.1)'; }
        else if (place.rank === 2) { medal = '🥈 2° POSTO'; color = '#94a3b8'; bgColor = 'rgba(148, 163, 184, 0.1)'; }
        else if (place.rank === 3) { medal = '🥉 3° POSTO'; color = '#b45309'; bgColor = 'rgba(180, 83, 9, 0.1)'; }
        
        const winnersNames = place.winners.join(' & ');
        
        container.innerHTML += `
            <div style="background: ${bgColor}; border: 2px solid ${color}; padding: 15px; border-radius: 12px;">
                <div style="color: ${color}; font-weight: bold; font-size: 1.2rem; margin-bottom: 5px;">${medal} (${place.score} pt)</div>
                <div style="font-size: 1.6rem; font-weight: 800; text-transform: uppercase; color: var(--text-main);">${winnersNames}</div>
            </div>
        `;
    });
}
