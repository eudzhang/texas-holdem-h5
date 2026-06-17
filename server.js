const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const rooms = new Map();
const clients = new Map();

const SUITS = [
  { key: "s", symbol: "♠", red: false },
  { key: "h", symbol: "♥", red: true },
  { key: "d", symbol: "♦", red: true },
  { key: "c", symbol: "♣", red: false }
];
const RANKS = [
  { label: "2", value: 2 }, { label: "3", value: 3 }, { label: "4", value: 4 },
  { label: "5", value: 5 }, { label: "6", value: 6 }, { label: "7", value: 7 },
  { label: "8", value: 8 }, { label: "9", value: 9 }, { label: "10", value: 10 },
  { label: "J", value: 11 }, { label: "Q", value: 12 }, { label: "K", value: 13 },
  { label: "A", value: 14 }
];
const STREETS = ["翻牌前", "翻牌", "转牌", "河牌"];
const HAND_NAMES = ["高牌", "一对", "两对", "三条", "顺子", "同花", "葫芦", "四条", "同花顺"];

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname === "/healthz") return json(res, { ok: true, rooms: rooms.size });
    if (req.method === "GET" && url.pathname === "/events") return handleEvents(req, res, url);
    if (req.method === "POST" && url.pathname === "/api/create") return json(res, createRoom(await readJson(req)));
    if (req.method === "POST" && url.pathname === "/api/join") return json(res, joinRoom(await readJson(req)));
    if (req.method === "POST" && url.pathname === "/api/start") return json(res, startHand(await readJson(req)));
    if (req.method === "POST" && url.pathname === "/api/action") return json(res, playerAction(await readJson(req)));
    return serveStatic(url.pathname, res);
  } catch (error) {
    json(res, { error: error.message || "服务器错误" }, 400);
  }
});

server.listen(PORT, () => {
  console.log(`Online Texas Hold'em running at http://localhost:${PORT}`);
});

function createRoom(body) {
  const roomCode = makeRoomCode();
  const player = makePlayer(body.name || "房主");
  const maxPlayers = clamp(Number(body.maxPlayers || 4), 2, 8);
  const room = {
    roomCode,
    hostId: player.id,
    maxPlayers,
    players: [player],
    deck: [],
    community: [],
    pot: 0,
    street: 0,
    currentBet: 0,
    currentTurn: -1,
    handOver: true,
    winners: [],
    resultText: "",
    log: ["房间已创建，等待朋友加入。"]
  };
  rooms.set(roomCode, room);
  broadcast(room);
  return { roomCode, playerId: player.id };
}

function joinRoom(body) {
  const room = getRoom(body.roomCode);
  if (room.players.length >= room.maxPlayers) throw new Error("房间已满。");
  if (!room.handOver && room.players.some((player) => player.hand.length)) throw new Error("本手牌进行中，请下一手再加入。");
  const player = makePlayer(body.name || "玩家");
  room.players.push(player);
  addLog(room, `${player.name} 加入了房间。`);
  broadcast(room);
  return { roomCode: room.roomCode, playerId: player.id };
}

function startHand(body) {
  const room = getRoom(body.roomCode);
  if (body.playerId !== room.hostId) throw new Error("只有房主可以开始。");
  if (room.players.length < 2) throw new Error("至少需要 2 人。");
  room.players.forEach((player) => {
    if (player.stack <= 0) player.stack = 1000;
    player.bet = 0;
    player.hand = [];
    player.folded = false;
    player.allIn = false;
    player.acted = false;
  });
  room.deck = shuffle(buildDeck());
  room.community = [];
  room.pot = 0;
  room.street = 0;
  room.currentBet = 0;
  room.handOver = false;
  room.winners = [];
  room.resultText = "";
  for (let round = 0; round < 2; round++) {
    room.players.forEach((player) => player.hand.push(room.deck.pop()));
  }
  postBlind(room, 0, 10);
  postBlind(room, 1 % room.players.length, 20);
  room.currentBet = 20;
  room.currentTurn = nextActiveIndex(room, 1 % room.players.length);
  addLog(room, "新手牌开始，小盲 10，大盲 20。");
  broadcast(room);
  return { ok: true };
}

function playerAction(body) {
  const room = getRoom(body.roomCode);
  const index = room.players.findIndex((player) => player.id === body.playerId);
  if (index < 0) throw new Error("玩家不存在。");
  if (room.handOver) throw new Error("本手牌已经结束。");
  if (index !== room.currentTurn) throw new Error("还没轮到你。");
  const player = room.players[index];
  const need = Math.max(0, room.currentBet - player.bet);
  if (body.type === "fold") {
    player.folded = true;
    player.acted = true;
    addLog(room, `${player.name} 弃牌。`);
  } else if (body.type === "call") {
    pay(room, player, need);
    player.acted = true;
    addLog(room, need === 0 ? `${player.name} 过牌。` : `${player.name} 跟注 ${need}。`);
  } else if (body.type === "raise") {
    const raiseBy = clamp(Number(body.raiseBy || 20), 20, 200);
    pay(room, player, need + raiseBy);
    room.currentBet = player.bet;
    room.players.forEach((seat) => {
      if (!seat.folded && !seat.allIn && seat.id !== player.id) seat.acted = false;
    });
    player.acted = true;
    addLog(room, `${player.name} 加注到 ${player.bet}。`);
  } else if (body.type === "allin") {
    const pushed = player.stack;
    pay(room, player, player.stack);
    if (player.bet > room.currentBet) {
      room.currentBet = player.bet;
      room.players.forEach((seat) => {
        if (!seat.folded && !seat.allIn && seat.id !== player.id) seat.acted = false;
      });
    }
    player.acted = true;
    addLog(room, `${player.name} 推了 ${pushed}。`);
  } else {
    throw new Error("未知操作。");
  }
  advance(room);
  broadcast(room);
  return { ok: true };
}

function advance(room) {
  const active = room.players.filter((player) => !player.folded);
  if (active.length === 1) return award(room, active[0], `${active[0].name} 赢得底池 ${room.pot}。`);
  if (active.every((player) => player.allIn || player.folded)) {
    while (room.community.length < 5) room.community.push(room.deck.pop());
    return showdown(room);
  }
  if (isBettingRoundClosed(room)) {
    if (shouldRunOutAllIn(room)) {
      while (room.community.length < 5) room.community.push(room.deck.pop());
      return showdown(room);
    }
    return nextStreet(room);
  }
  room.currentTurn = nextActiveIndex(room, room.currentTurn);
}

function isBettingRoundClosed(room) {
  return room.players
    .filter((player) => !player.folded && !player.allIn)
    .every((player) => player.acted && player.bet === room.currentBet);
}

function shouldRunOutAllIn(room) {
  const active = room.players.filter((player) => !player.folded);
  return active.some((player) => player.allIn) && active.filter((player) => !player.allIn).length <= 1;
}

function nextStreet(room) {
  room.players.forEach((player) => {
    player.bet = 0;
    player.acted = false;
  });
  room.currentBet = 0;
  if (room.street === 0) {
    room.community.push(room.deck.pop(), room.deck.pop(), room.deck.pop());
    room.street = 1;
    addLog(room, "翻牌。");
  } else if (room.street === 1) {
    room.community.push(room.deck.pop());
    room.street = 2;
    addLog(room, "转牌。");
  } else if (room.street === 2) {
    room.community.push(room.deck.pop());
    room.street = 3;
    addLog(room, "河牌。");
  } else {
    return showdown(room);
  }
  room.currentTurn = nextActiveIndex(room, -1);
}

function showdown(room) {
  const ranked = room.players
    .filter((player) => !player.folded)
    .map((player) => ({ player, score: evaluateBest([...player.hand, ...room.community]) }))
    .sort((a, b) => compareScores(b.score, a.score));
  const top = ranked[0];
  const tied = ranked.filter((entry) => compareScores(entry.score, top.score) === 0);
  const share = Math.floor(room.pot / tied.length);
  tied.forEach((entry) => {
    entry.player.stack += share;
  });
  room.handOver = true;
  room.currentTurn = -1;
  const winners = tied.map((entry) => entry.player.name).join("、");
  room.winners = tied.map((entry) => entry.player.id);
  room.resultText = `${winners} 凭 ${HAND_NAMES[top.score.rank]} 赢得 ${share * tied.length}`;
  addLog(room, `摊牌：${room.resultText}。`);
}

function award(room, player, text) {
  player.stack += room.pot;
  room.handOver = true;
  room.currentTurn = -1;
  room.winners = [player.id];
  room.resultText = text.replace(/。$/, "");
  addLog(room, text);
}

function postBlind(room, index, amount) {
  const player = room.players[index];
  pay(room, player, amount);
  player.acted = false;
}

function pay(room, player, amount) {
  const paid = Math.min(player.stack, Math.max(0, amount));
  player.stack -= paid;
  player.bet += paid;
  room.pot += paid;
  if (player.stack === 0) player.allIn = true;
}

function nextActiveIndex(room, from) {
  for (let step = 1; step <= room.players.length; step++) {
    const index = (from + step + room.players.length) % room.players.length;
    const player = room.players[index];
    if (!player.folded && !player.allIn) return index;
  }
  return -1;
}

function makePlayer(name) {
  return {
    id: crypto.randomBytes(12).toString("hex"),
    name: String(name).trim().slice(0, 12) || "玩家",
    stack: 1000,
    bet: 0,
    hand: [],
    folded: false,
    allIn: false,
    acted: false,
    connected: false
  };
}

function buildDeck() {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({ ...rank, suit })));
}

function shuffle(deck) {
  const copy = [...deck];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function cardView(card) {
  return { label: card.label, suit: card.suit.symbol, red: card.suit.red };
}

function snapshot(room, viewerId) {
  const me = room.players.find((player) => player.id === viewerId);
  const current = room.players[room.currentTurn];
  const canAct = Boolean(me && current && current.id === me.id && !room.handOver);
  return {
    roomCode: room.roomCode,
    maxPlayers: room.maxPlayers,
    isHost: room.hostId === viewerId,
    players: room.players.map((player, index) => ({
      name: player.name,
      stack: player.stack,
      bet: player.bet,
      folded: player.folded,
      allIn: player.allIn,
      connected: player.connected,
      isMe: player.id === viewerId,
      isTurn: index === room.currentTurn,
      isWinner: room.winners.includes(player.id),
      hand: visibleHand(room, player, viewerId)
    })),
    community: room.community.map(cardView),
    pot: room.pot,
    phase: room.handOver ? "等待开局" : STREETS[room.street],
    currentBet: room.currentBet,
    canAct,
    resultText: room.handOver ? room.resultText : "",
    statusTitle: statusTitle(room, viewerId),
    statusText: statusText(room, viewerId),
    log: room.log.slice(0, 14)
  };
}

function visibleHand(room, player, viewerId) {
  const show = player.id === viewerId || (room.handOver && !player.folded);
  return player.hand.map((card) => show ? cardView(card) : { hidden: true });
}

function statusTitle(room, viewerId) {
  if (!room.players.some((player) => player.id === viewerId)) return "旁观中";
  if (room.handOver) return "等待房主开局";
  const current = room.players[room.currentTurn];
  if (!current) return "等待结算";
  return current.id === viewerId ? "轮到你行动" : `等待 ${current.name}`;
}

function statusText(room, viewerId) {
  const me = room.players.find((player) => player.id === viewerId);
  if (!me) return "这个房间正在进行。";
  if (room.handOver) return room.hostId === viewerId ? "人数满 2 人后，点击左上角开始按钮发新牌。" : "等待房主开始下一手牌。";
  const current = room.players[room.currentTurn];
  if (current?.id !== viewerId) return "朋友行动后，牌桌会自动同步。";
  const need = Math.max(0, room.currentBet - me.bet);
  return need === 0 ? "当前无人下注，可以过牌或主动加注。" : `当前需要 ${need} 才能继续，也可以弃牌。`;
}

function addLog(room, text) {
  room.log.unshift(text);
  room.log = room.log.slice(0, 30);
}

function handleEvents(req, res, url) {
  const room = getRoom(url.searchParams.get("room"));
  const playerId = url.searchParams.get("player");
  const player = room.players.find((seat) => seat.id === playerId);
  if (!player) throw new Error("玩家不存在。");
  player.connected = true;
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "access-control-allow-origin": "*"
  });
  const client = { res, playerId };
  if (!clients.has(room.roomCode)) clients.set(room.roomCode, new Set());
  clients.get(room.roomCode).add(client);
  sendState(room, client);
  broadcast(room);
  req.on("close", () => {
    clients.get(room.roomCode)?.delete(client);
    player.connected = false;
    broadcast(room);
  });
}

function broadcast(room) {
  const set = clients.get(room.roomCode);
  if (!set) return;
  for (const client of set) sendState(room, client);
}

function sendState(room, client) {
  client.res.write(`event: state\ndata: ${JSON.stringify(snapshot(room, client.playerId))}\n\n`);
}

function getRoom(roomCode) {
  const room = rooms.get(String(roomCode || "").toUpperCase());
  if (!room) throw new Error("房间不存在。");
  return room;
}

function makeRoomCode() {
  let code;
  do {
    code = crypto.randomBytes(3).toString("hex").toUpperCase();
  } while (rooms.has(code));
  return code;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1e6) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("JSON 格式错误。"));
      }
    });
    req.on("error", reject);
  });
}

function json(res, data, status = 200) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function serveStatic(urlPath, res) {
  const clean = decodeURIComponent(urlPath === "/" ? "/index.html" : urlPath);
  const filePath = path.normalize(path.join(ROOT, clean));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      return res.end("Not found");
    }
    res.writeHead(200, { "content-type": contentType(filePath) });
    res.end(data);
  });
}

function contentType(filePath) {
  const ext = path.extname(filePath);
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8"
  }[ext] || "application/octet-stream";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function evaluateBest(cards) {
  return choose(cards, 5).map(evaluateFive).sort(compareScores).at(-1);
}

function evaluateFive(cards) {
  const values = cards.map((c) => c.value).sort((a, b) => b - a);
  const counts = countBy(values);
  const groups = Object.entries(counts)
    .map(([value, count]) => ({ value: Number(value), count }))
    .sort((a, b) => b.count - a.count || b.value - a.value);
  const flush = cards.every((c) => c.suit.key === cards[0].suit.key);
  const straightHigh = getStraightHigh(values);
  if (flush && straightHigh) return score(8, [straightHigh]);
  if (groups[0].count === 4) return score(7, [groups[0].value, groups[1].value]);
  if (groups[0].count === 3 && groups[1].count === 2) return score(6, [groups[0].value, groups[1].value]);
  if (flush) return score(5, values);
  if (straightHigh) return score(4, [straightHigh]);
  if (groups[0].count === 3) return score(3, [groups[0].value, ...groups.slice(1).map((g) => g.value).sort((a, b) => b - a)]);
  if (groups[0].count === 2 && groups[1].count === 2) {
    const pairs = groups.filter((g) => g.count === 2).map((g) => g.value).sort((a, b) => b - a);
    return score(2, [...pairs, groups.find((g) => g.count === 1).value]);
  }
  if (groups[0].count === 2) return score(1, [groups[0].value, ...groups.slice(1).map((g) => g.value).sort((a, b) => b - a)]);
  return score(0, values);
}

function score(rank, kickers) {
  return { rank, kickers };
}

function compareScores(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  for (let i = 0; i < Math.max(a.kickers.length, b.kickers.length); i++) {
    const diff = (a.kickers[i] || 0) - (b.kickers[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function getStraightHigh(values) {
  const unique = [...new Set(values)].sort((a, b) => b - a);
  if (unique.includes(14)) unique.push(1);
  for (let i = 0; i <= unique.length - 5; i++) {
    const run = unique.slice(i, i + 5);
    if (run[0] - run[4] === 4) return run[0];
  }
  return 0;
}

function countBy(values) {
  return values.reduce((map, value) => {
    map[value] = (map[value] || 0) + 1;
    return map;
  }, {});
}

function choose(items, size) {
  const result = [];
  function walk(start, combo) {
    if (combo.length === size) {
      result.push(combo);
      return;
    }
    for (let i = start; i < items.length; i++) walk(i + 1, [...combo, items[i]]);
  }
  walk(0, []);
  return result;
}
