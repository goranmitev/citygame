import http from 'http';
import { Server, Socket } from 'socket.io';

const PORT = parseInt(process.env.PORT ?? '3001');
const MAX_PLAYERS = 4;
const RESTAURANT_COUNT = 12;
const ORDER_INTERVAL_MIN = 5_000;
const ORDER_INTERVAL_MAX = 15_000;
const ORDER_VALUE_MIN = 8;
const ORDER_VALUE_MAX = 25;
const BASE_PAY = 1.0;
const MAX_TIP = 0.5;

const LOBBY_COLORS = [
  '#e74c3c', '#e67e22', '#f1c40f', '#2ecc71',
  '#1abc9c', '#3498db', '#9b59b6', '#ecf0f1',
];

interface PosMsg {
  x: number; y: number; z: number;
  heading: number; speed: number; steer: number;
  isInCar: boolean;
}

interface ActiveDelivery {
  restaurantIndex: number;
  orderValue: number;
  destCx: number; destCz: number;
  timeLimit: number;
  startedAt: number;
}

interface Player {
  id: string;
  carColor: string;
  shirtColor: string;
  playerIndex: number;
  nickname: string;
  pos: PosMsg;
  balance: number;
  failures: number;
  delivery: ActiveDelivery | null;
}

interface Restaurant {
  hasOrder: boolean;
  orderValue: number;
  lockedBy: string | null;
}

const players = new Map<string, Player>();
let nextPlayerIndex = 0;

const rests: Restaurant[] = Array.from({ length: RESTAURANT_COUNT }, () => ({
  hasOrder: false, orderValue: 0, lockedBy: null,
}));

function pickColor(preferred: string | undefined, field: 'carColor' | 'shirtColor', excludeId: string): string {
  const taken = new Set<string>();
  for (const [id, p] of players) {
    if (id !== excludeId) taken.add(p[field]);
  }
  if (preferred && LOBBY_COLORS.includes(preferred) && !taken.has(preferred)) return preferred;
  for (const c of LOBBY_COLORS) {
    if (!taken.has(c)) return c;
  }
  return LOBBY_COLORS[0];
}

const httpServer = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'GET' && req.url === '/status') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ playerCount: players.size, maxPlayers: MAX_PLAYERS }));
    return;
  }
  if (req.method === 'GET' && req.url === '/colors') {
    const takenCarColors = [...players.values()].map(p => p.carColor);
    const takenShirtColors = [...players.values()].map(p => p.shirtColor);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ takenCarColors, takenShirtColors }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const io = new Server(httpServer, { cors: { origin: '*' } });

function getScores(): Record<string, { color: string; balance: number; failures: number; nickname: string }> {
  const out: Record<string, { color: string; balance: number; failures: number; nickname: string }> = {};
  for (const [id, p] of players) {
    out[id] = { color: p.carColor, balance: p.balance, failures: p.failures, nickname: p.nickname };
  }
  return out;
}

function scheduleOrder(): void {
  const delay = ORDER_INTERVAL_MIN + Math.random() * (ORDER_INTERVAL_MAX - ORDER_INTERVAL_MIN);
  setTimeout(trySpawnOrder, delay);
}

function trySpawnOrder(): void {
  if (players.size > 0) {
    const avail = rests.map((r, i) => ({ r, i })).filter(({ r }) => !r.hasOrder && r.lockedBy === null);
    if (avail.length > 0) {
      const { r, i } = avail[Math.floor(Math.random() * avail.length)];
      r.hasOrder = true;
      r.orderValue = ORDER_VALUE_MIN + Math.round(Math.random() * (ORDER_VALUE_MAX - ORDER_VALUE_MIN));
      io.emit('delivery:order_spawned', { restaurantIndex: i, orderValue: r.orderValue });
    }
  }
  scheduleOrder();
}

setInterval(() => {
  const now = Date.now();
  for (const [id, p] of players) {
    if (!p.delivery) continue;
    const elapsed = (now - p.delivery.startedAt) / 1000;
    if (elapsed >= p.delivery.timeLimit) {
      const { restaurantIndex } = p.delivery;
      rests[restaurantIndex].lockedBy = null;
      p.delivery = null;
      p.failures++;
      io.emit('delivery:failed', { playerId: id, failures: p.failures, scores: getScores() });
    }
  }
}, 1000);

io.on('connection', (socket: Socket) => {
  if (players.size >= MAX_PLAYERS) {
    socket.emit('server:full');
    socket.disconnect(true);
    return;
  }

  // Kick client if no configure arrives within 5 seconds
  const configureTimeout = setTimeout(() => socket.disconnect(true), 5000);

  socket.once('player:configure', (data: { nickname?: string; carColor?: string; shirtColor?: string }) => {
    clearTimeout(configureTimeout);

    const playerIndex = nextPlayerIndex++;
    const carColor   = pickColor(data.carColor,   'carColor',   socket.id);
    const shirtColor = pickColor(data.shirtColor, 'shirtColor', socket.id);
    const nickname   = (typeof data.nickname === 'string' ? data.nickname.slice(0, 20) : '') || 'Player';

    const player: Player = {
      id: socket.id, carColor, shirtColor, playerIndex, nickname,
      pos: { x: 0, y: 0, z: 0, heading: 0, speed: 0, steer: 0, isInCar: false },
      balance: 0, failures: 0, delivery: null,
    };
    players.set(socket.id, player);

    socket.emit('game:welcome', {
      playerId: socket.id,
      carColor,
      shirtColor,
      playerIndex,
      gameState: {
        players: [...players.values()]
          .filter(p => p.id !== socket.id)
          .map(p => ({ id: p.id, carColor: p.carColor, shirtColor: p.shirtColor, ...p.pos })),
        restaurants: rests.map(r => ({ hasOrder: r.hasOrder, orderValue: r.orderValue, lockedBy: r.lockedBy })),
        scores: getScores(),
      },
    });

    socket.broadcast.emit('player:joined', { playerId: socket.id, carColor, shirtColor, nickname });

    socket.on('player:position', (data: PosMsg) => {
      const p = players.get(socket.id);
      if (p) p.pos = data;
      socket.broadcast.emit('player:position', { playerId: socket.id, ...data });
    });

    socket.on('delivery:pickup_request', (data: { restaurantIndex: number; destCx: number; destCz: number; timeLimit: number }) => {
      const p = players.get(socket.id);
      if (!p || p.delivery) {
        socket.emit('delivery:pickup_denied', { restaurantIndex: data.restaurantIndex });
        return;
      }
      const r = rests[data.restaurantIndex];
      if (!r || !r.hasOrder || r.lockedBy !== null) {
        socket.emit('delivery:pickup_denied', { restaurantIndex: data.restaurantIndex });
        return;
      }
      r.hasOrder = false;
      r.lockedBy = socket.id;
      p.delivery = {
        restaurantIndex: data.restaurantIndex,
        orderValue: r.orderValue,
        destCx: data.destCx, destCz: data.destCz,
        timeLimit: data.timeLimit,
        startedAt: Date.now(),
      };
      socket.emit('delivery:pickup_confirmed', {
        restaurantIndex: data.restaurantIndex,
        orderValue: r.orderValue,
        timeLimit: data.timeLimit,
        destCx: data.destCx, destCz: data.destCz,
      });
      socket.broadcast.emit('delivery:pickup_locked', { playerId: socket.id, restaurantIndex: data.restaurantIndex });
    });

    socket.on('car:impact', (data: { targetId: string; vx: number; vz: number }) => {
      io.to(data.targetId).emit('car:impact', { fromId: socket.id, vx: data.vx, vz: data.vz });
    });

    socket.on('delivery:deliver_request', () => {
      const p = players.get(socket.id);
      if (!p || !p.delivery) return;
      const elapsed = (Date.now() - p.delivery.startedAt) / 1000;
      if (elapsed > p.delivery.timeLimit + 2) return;
      const remaining = Math.max(0, p.delivery.timeLimit - elapsed);
      const tipFrac   = (remaining / p.delivery.timeLimit) * MAX_TIP;
      const pay       = Math.round(p.delivery.orderValue * (BASE_PAY + tipFrac));
      const { restaurantIndex } = p.delivery;
      rests[restaurantIndex].lockedBy = null;
      p.delivery  = null;
      p.balance  += pay;
      io.emit('delivery:delivered', { playerId: socket.id, pay, scores: getScores() });
    });
  });

  socket.on('disconnect', () => {
    clearTimeout(configureTimeout);
    const p = players.get(socket.id);
    if (!p) return;
    if (p.delivery) rests[p.delivery.restaurantIndex].lockedBy = null;
    players.delete(socket.id);
    io.emit('player:left', { playerId: socket.id });
    if (players.size === 0) {
      for (const r of rests) { r.hasOrder = false; r.lockedBy = null; }
      nextPlayerIndex = 0;
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`CityCame multiplayer server on port ${PORT}`);
  scheduleOrder();
});
