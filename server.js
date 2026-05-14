const http = require('http');
const WebSocket = require('ws');

const port = Number(process.env.PORT || 10000);
const rooms = new Map();

function getRoom(roomName) {
  if (!rooms.has(roomName)) {
    rooms.set(roomName, new Map());
  }
  return rooms.get(roomName);
}

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcast(roomName, senderId, payload) {
  const room = getRoom(roomName);
  for (const [clientId, ws] of room.entries()) {
    if (clientId === senderId) {
      continue;
    }
    send(ws, payload);
  }
}

function removeClient(ws) {
  const roomName = ws.room;
  const clientId = ws.clientId;
  if (!roomName || !clientId) {
    return;
  }

  const room = getRoom(roomName);
  room.delete(clientId);
  broadcast(roomName, clientId, {
    type: 'peer-left',
    peerId: clientId
  });

  if (room.size === 0) {
    rooms.delete(roomName);
  }
}

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }

  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Imperivm online relay attivo');
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString('utf8'));
    } catch {
      return;
    }

    if (message.type === 'hello') {
      ws.room = message.room || 'imperivm-public';
      ws.clientId = message.clientId;

      if (!ws.clientId) {
        return;
      }

      const room = getRoom(ws.room);
      room.set(ws.clientId, ws);
      send(ws, { type: 'hello-ack' });
      return;
    }

    if (message.type === 'udp' && ws.room && ws.clientId && message.payload) {
      const packet = {
        type: 'udp',
        peerId: ws.clientId,
        payload: message.payload
      };

      if (message.targetClientId) {
        const room = getRoom(ws.room);
        const target = room.get(message.targetClientId);
        if (target) {
          send(target, packet);
        }
        return;
      }

      broadcast(ws.room, ws.clientId, packet);
    }
  });

  ws.on('close', () => {
    removeClient(ws);
  });

  ws.on('error', () => {
    removeClient(ws);
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Imperivm relay in ascolto sulla porta ${port}`);
});
