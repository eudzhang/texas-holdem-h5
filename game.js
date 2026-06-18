const $ = (id) => document.getElementById(id);
const els = {
  lobby: $("lobby"),
  modeCard: $("modeCard"),
  aiMode: $("aiModeBtn"),
  onlineMode: $("onlineModeBtn"),
  backToMode: $("backToModeBtn"),
  nameInput: $("nameInput"),
  maxPlayers: $("maxPlayersInput"),
  playerCountOptions: Array.from(document.querySelectorAll(".player-count-option")),
  roomInput: $("roomInput"),
  createRoom: $("createRoomBtn"),
  joinRoom: $("joinRoomBtn"),
  copyLink: $("copyLinkBtn"),
  startHand: $("startHandBtn"),
  home: $("homeBtn"),
  roomCode: $("roomCode"),
  opponents: $("opponents"),
  community: $("community"),
  playerHand: $("playerHand"),
  playerInfo: $("playerInfo"),
  potChips: $("potChips"),
  pot: $("pot"),
  phase: $("phase"),
  currentAction: $("currentAction"),
  toCall: $("toCall"),
  statusTitle: $("statusTitle"),
  statusText: $("statusText"),
  fold: $("foldBtn"),
  call: $("callBtn"),
  raise: $("raiseBtn"),
  allIn: $("allInBtn"),
  raiseAmount: $("raiseAmount"),
  raiseValue: $("raiseValue"),
  log: $("log")
};

const HAND_NAMES = ["高牌", "一对", "两对", "三条", "顺子", "同花", "葫芦", "四条", "同花顺"];
const STORAGE_KEY = "online-texas-room";
let session = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
let source;
let snapshot;
let reconnectTimer;
let appMode = null;
let aiGame = null;

const STAGE_WIDTH = 1365;
const STAGE_HEIGHT = 768;

function fitGameStage() {
  const viewport = window.visualViewport;
  const width = viewport?.width || window.innerWidth;
  const height = viewport?.height || window.innerHeight;
  const scale = Math.min(width / STAGE_WIDTH, height / STAGE_HEIGHT);
  document.documentElement.style.setProperty("--game-scale", String(scale));
}

fitGameStage();
window.addEventListener("resize", fitGameStage);
window.visualViewport?.addEventListener("resize", fitGameStage);

const urlRoom = new URLSearchParams(location.search).get("room");
if (urlRoom) {
  appMode = "online";
  els.lobby.classList.add("online-mode");
  els.roomInput.value = urlRoom.toUpperCase();
}
els.nameInput.value = localStorage.getItem("online-texas-name") || "";
if (session?.roomCode && session?.playerId && appMode === "online") connect(session.roomCode, session.playerId);

async function api(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "请求失败");
  return data;
}

async function createRoom() {
  try {
    appMode = "online";
    const name = getName();
    const data = await api("/api/create", { name, maxPlayers: Number(els.maxPlayers.value) });
    saveSession(data.roomCode, data.playerId, name);
    connect(data.roomCode, data.playerId);
  } catch (error) {
    showError(error.message);
  }
}

async function joinRoom() {
  try {
    appMode = "online";
    const name = getName();
    const roomCode = els.roomInput.value.trim().toUpperCase();
    if (!roomCode) throw new Error("请输入房间号。");
    const data = await api("/api/join", { roomCode, name });
    saveSession(data.roomCode, data.playerId, name);
    connect(data.roomCode, data.playerId);
  } catch (error) {
    showError(error.message);
  }
}

function saveSession(roomCode, playerId, name) {
  session = { roomCode, playerId };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  localStorage.setItem("online-texas-name", name);
}

function connect(roomCode, playerId) {
  if (source) source.close();
  if (reconnectTimer) clearTimeout(reconnectTimer);
  snapshot = null;
  source = new EventSource(`/events?room=${encodeURIComponent(roomCode)}&player=${encodeURIComponent(playerId)}`);
  source.addEventListener("state", (event) => {
    snapshot = JSON.parse(event.data);
    render(snapshot);
  });
  source.onerror = () => {
    els.statusTitle.textContent = "连接中断";
    els.statusText.textContent = "正在尝试重连。如果服务器刚启动，请稍等几秒。";
  };
  reconnectTimer = setTimeout(() => {
    if (!snapshot) {
      clearSession();
      showLobby("房间已失效", "服务器重启后旧房间会清空。请重新创建房间，再把新链接发给朋友。");
    }
  }, 3500);
}

async function sendAction(type) {
  if (appMode === "ai") {
    aiPlayerAction(type);
    return;
  }
  if (!session) return;
  try {
    await api("/api/action", {
      roomCode: session.roomCode,
      playerId: session.playerId,
      type,
      raiseBy: Number(els.raiseAmount.value)
    });
  } catch (error) {
    showError(error.message);
  }
}

async function startHand() {
  if (appMode === "ai") {
    startAiHand();
    return;
  }
  if (!session) return;
  try {
    await api("/api/start", session);
  } catch (error) {
    showError(error.message);
  }
}

function render(data) {
  const me = data.players.find((player) => player.isMe);
  const joined = Boolean(data.roomCode && data.roomCode !== "未加入");
  document.body.dataset.players = String(data.players.length || 0);
  document.body.dataset.maxPlayers = String(data.maxPlayers || (appMode === "ai" ? 4 : Number(els.maxPlayers.value || 4)));
  els.lobby.hidden = joined;
  document.body.classList.toggle("lobby-open", !joined);
  els.roomCode.textContent = data.maxPlayers ? `${data.roomCode} · ${data.players.length}/${data.maxPlayers}人` : data.roomCode;
  els.copyLink.hidden = appMode === "ai";
  els.copyLink.disabled = appMode === "ai" || !joined;
  els.startHand.disabled = appMode !== "ai" && (!joined || !data.isHost || data.players.length < 2);
  els.startHand.title = appMode === "ai" ? "开始新手牌" : (data.isHost ? "开始新手牌" : "只有房主可以开始");
  els.home.hidden = !data.resultText;
  els.opponents.innerHTML = data.players.filter((player) => !player.isMe).map(renderOpponent).join("");
  els.community.innerHTML = renderCards(data.community, true, 5);
  els.playerHand.innerHTML = renderCards(me?.hand || [], true, 2);
  els.playerInfo.className = `player-info ${me?.bet > 0 ? "has-bet" : ""}`;
  els.playerInfo.innerHTML = renderSeatPanel(me || { name: "你", stack: 0, bet: 0, connected: true }, true);
  els.playerInfo.classList.toggle("turn", Boolean(me?.isTurn));
  els.potChips.innerHTML = renderChipStack(data.pot, "pot");
  els.pot.textContent = data.pot;
  els.phase.textContent = data.phase;
  const need = Math.max(0, data.currentBet - (me?.bet || 0));
  els.toCall.textContent = need;
  renderCurrentAction(data);
  els.call.textContent = need === 0 ? "过牌" : `跟注 ${need}`;
  const minRaise = Math.max(20, Number(data.minRaise || 20));
  const maxRaise = Math.max(minRaise, (me?.stack || 0) - need - 1);
  els.raiseAmount.min = String(minRaise);
  els.raiseAmount.max = String(maxRaise);
  els.raiseAmount.step = "10";
  if (Number(els.raiseAmount.value) < minRaise || Number(els.raiseAmount.value) > maxRaise) {
    els.raiseAmount.value = String(minRaise);
  }
  els.raiseValue.textContent = els.raiseAmount.value;
  els.raise.textContent = `加注 +${els.raiseAmount.value}`;
  const canAct = Boolean(data.canAct);
  els.fold.disabled = !canAct;
  els.call.disabled = !canAct;
  els.raise.disabled = !canAct || data.canRaise === false || (me?.stack || 0) <= need + minRaise;
  els.allIn.disabled = !canAct || (me?.stack || 0) <= 0 || (data.canRaise === false && (me?.stack || 0) > need);
  els.statusTitle.textContent = data.statusTitle;
  els.statusText.textContent = data.statusText;
  els.log.innerHTML = data.log.map((line) => `<p>${escapeHtml(line)}</p>`).join("");
}

function renderOpponent(player) {
  const turn = player.isTurn ? " turn" : "";
  const winner = player.isWinner ? " winner" : "";
  return `
    <article class="seat${turn}${winner}">
      ${renderSeatPanel(player, false)}
      <div class="cards">${renderCards(player.hand, true, 2)}</div>
    </article>
  `;
}

function renderSeatPanel(player, isMe) {
  const stateClass = player.folded ? "folded" : "";
  const stateText = player.folded ? "已弃牌" : (player.allIn ? "全下" : player.connected ? "在线" : "离线");
  const betClass = player.bet > 0 ? "has-bet" : "";
  const winnerBadge = player.isWinner ? `<span class="winner-badge">WINNER</span>` : "";
  const positionClass = player.position?.includes("BB") ? "bb" : player.position?.includes("SB") ? "sb" : "dealer";
  const positionBadge = player.position ? `<span class="position-badge ${positionClass}">${player.position}</span>` : "";
  const content = `
        <div class="chip-stack seat-stack">${renderChipStack(player.stack, "seat")}</div>
        <div class="seat-main">
          <div class="seat-name-row">
            <span class="name">${isMe ? "你 · " : ""}${escapeHtml(player.name)}</span>
            ${positionBadge}
            ${winnerBadge}
            <span class="state ${stateClass}">${stateText}</span>
          </div>
          <div class="seat-money-grid">
            <span>剩余筹码</span>
            <strong>${player.stack}</strong>
            <span>本轮下注</span>
            <strong class="${betClass}">${player.bet}</strong>
          </div>
        </div>
        ${player.bet > 0 ? `<div class="wager">${renderChipStack(player.bet, "wager")}<b>${player.bet}</b></div>` : ""}
  `;
  if (isMe) return content;
  return `<div class="opponent-meta ${betClass}">${content}</div>`;
}

function buildCurrentAction(data) {
  if (!data.roomCode || data.roomCode === "未加入") return "创建房间后开始";
  if (data.canAct) return "轮到你行动";
  const current = data.players.find((player) => player.isTurn);
  if (current) return `等待 ${current.name} 行动`;
  return data.phase;
}

function renderCurrentAction(data) {
  if (data.resultText) {
    els.currentAction.className = "current-action result-banner";
    els.currentAction.innerHTML = `<span>本手胜者</span><strong>${escapeHtml(data.resultText)}</strong>`;
    return;
  }
  els.currentAction.className = "current-action";
  els.currentAction.textContent = buildCurrentAction(data);
}

function renderChipStack(amount, variant) {
  const value = Math.max(0, Number(amount) || 0);
  const count = Math.min(6, Math.max(value > 0 ? 1 : 0, Math.ceil(value / 220)));
  const colors = ["gold", "red", "blue", "green", "black", "cream"];
  return Array.from({ length: count }, (_, index) => {
    const color = colors[(index + (variant === "pot" ? 1 : 0)) % colors.length];
    const lift = variant === "wager" ? index * 3 : index * 4;
    return `<i class="chip ${color}" style="--lift:${lift}px"></i>`;
  }).join("");
}

const SUITS = [
  { symbol: "♠", red: false, key: "s" },
  { symbol: "♥", red: true, key: "h" },
  { symbol: "♦", red: true, key: "d" },
  { symbol: "♣", red: false, key: "c" }
];
const RANKS = [
  { label: "2", value: 2 }, { label: "3", value: 3 }, { label: "4", value: 4 },
  { label: "5", value: 5 }, { label: "6", value: 6 }, { label: "7", value: 7 },
  { label: "8", value: 8 }, { label: "9", value: 9 }, { label: "10", value: 10 },
  { label: "J", value: 11 }, { label: "Q", value: 12 }, { label: "K", value: 13 },
  { label: "A", value: 14 }
];
const STREETS = ["翻牌前", "翻牌", "转牌", "河牌"];

function enterAiMode() {
  appMode = "ai";
  clearSession();
  els.lobby.hidden = true;
  els.roomCode.textContent = "AI练习";
  els.copyLink.disabled = true;
  startAiHand();
}

function enterOnlineMode() {
  appMode = "online";
  els.lobby.hidden = false;
  els.lobby.classList.add("online-mode");
  renderEmpty("好友联机", "输入昵称后创建房间，或输入朋友给你的房间号加入。");
}

function backToModeSelect() {
  appMode = null;
  clearSession();
  aiGame = null;
  snapshot = null;
  if (location.search) history.replaceState(null, "", location.pathname);
  els.lobby.hidden = false;
  els.lobby.classList.remove("online-mode");
  renderEmpty("选择玩法", "选择 AI 练习或好友联机。");
}

function startAiHand() {
  const stacks = aiGame?.players?.map((player) => player.stack > 0 ? player.stack : 1000) || [1000, 1000, 1000, 1000];
  const dealerIndex = ((aiGame?.dealerIndex ?? -1) + 1) % 4;
  aiGame = {
    deck: shuffle(buildDeck()),
    players: [
      { name: els.nameInput.value.trim() || "你", stack: stacks[0], bet: 0, contribution: 0, hand: [], folded: false, allIn: false, acted: false, raiseAllowed: true, isMe: true, connected: true },
      { name: "AI 西座", stack: stacks[1], bet: 0, contribution: 0, hand: [], folded: false, allIn: false, acted: false, raiseAllowed: true, connected: true },
      { name: "AI 北座", stack: stacks[2], bet: 0, contribution: 0, hand: [], folded: false, allIn: false, acted: false, raiseAllowed: true, connected: true },
      { name: "AI 东座", stack: stacks[3], bet: 0, contribution: 0, hand: [], folded: false, allIn: false, acted: false, raiseAllowed: true, connected: true }
    ],
    community: [],
    pot: 0,
    street: 0,
    currentBet: 0,
    minRaise: 20,
    currentTurn: -1,
    dealerIndex,
    smallBlindIndex: (dealerIndex + 1) % 4,
    bigBlindIndex: (dealerIndex + 2) % 4,
    handOver: false,
    winners: [],
    resultText: "",
    log: []
  };
  for (let round = 0; round < 2; round++) aiGame.players.forEach((player) => player.hand.push(aiGame.deck.pop()));
  aiPay(aiGame.players[aiGame.smallBlindIndex], 10);
  aiPay(aiGame.players[aiGame.bigBlindIndex], 20);
  aiGame.currentBet = 20;
  aiGame.currentTurn = aiNextActiveIndex(aiGame.bigBlindIndex);
  aiLog(`${aiGame.players[dealerIndex].name} 在庄家位。${aiGame.players[aiGame.smallBlindIndex].name} 下小盲 10，${aiGame.players[aiGame.bigBlindIndex].name} 下大盲 20。`);
  aiContinue();
}

function aiPlayerAction(type) {
  if (!aiGame || aiGame.handOver || aiGame.currentTurn !== 0) return;
  const me = aiGame.players[0];
  const need = Math.max(0, aiGame.currentBet - me.bet);
  if (type === "fold") {
    me.folded = true;
    me.acted = true;
    me.raiseAllowed = false;
    aiLog("你弃牌。");
  } else if (type === "call") {
    aiPay(me, need);
    me.acted = true;
    me.raiseAllowed = false;
    aiLog(need === 0 ? "你过牌。" : `你跟注 ${need}。`);
  } else if (type === "raise") {
    const raiseBy = Number(els.raiseAmount.value);
    if (!me.raiseAllowed || raiseBy < aiGame.minRaise || need + raiseBy >= me.stack) return;
    aiPay(me, need + raiseBy);
    aiGame.currentBet = me.bet;
    aiGame.minRaise = raiseBy;
    aiResetActionAfterRaise(0);
    me.acted = true;
    me.raiseAllowed = false;
    aiLog(`你加注到 ${me.bet}。`);
  } else if (type === "allin") {
    const pushed = me.stack;
    const oldBet = aiGame.currentBet;
    aiPay(me, me.stack);
    if (me.bet > aiGame.currentBet) {
      aiGame.currentBet = me.bet;
      const raiseSize = me.bet - oldBet;
      if (raiseSize >= aiGame.minRaise) {
        aiGame.minRaise = raiseSize;
        aiResetActionAfterRaise(0);
      }
    }
    me.acted = true;
    me.raiseAllowed = false;
    aiLog(`你推了 ${pushed}。`);
  }
  aiAdvance();
  aiContinue();
}

function aiContinue() {
  let guard = 0;
  while (!aiGame.handOver && aiGame.currentTurn !== 0 && guard < 100) {
    aiAct(aiGame.currentTurn);
    aiAdvance();
    guard += 1;
  }
  renderAi();
}

function aiAct(index) {
  const player = aiGame.players[index];
  if (player.folded || player.allIn || aiGame.handOver) return;
  const need = Math.max(0, aiGame.currentBet - player.bet);
  const strength = aiStrength(player);
  if (need > 0 && strength + Math.random() * 0.35 < need / Math.max(1, player.stack + player.bet) + 0.2) {
    player.folded = true;
    player.acted = true;
    player.raiseAllowed = false;
    aiLog(`${player.name} 弃牌。`);
    return;
  }
  if (need === 0 && player.raiseAllowed && strength > 0.78 && player.stack > 40 && Math.random() > 0.5) {
    const raiseBy = Math.min(player.stack, randomStep(30, 90));
    aiPay(player, raiseBy);
    aiGame.currentBet = player.bet;
    aiGame.minRaise = raiseBy;
    aiResetActionAfterRaise(index);
    player.acted = true;
    player.raiseAllowed = false;
    aiLog(`${player.name} 加注到 ${player.bet}。`);
    return;
  }
  aiPay(player, need);
  player.acted = true;
  player.raiseAllowed = false;
  aiLog(need === 0 ? `${player.name} 过牌。` : `${player.name} 跟注 ${need}。`);
}

function aiAdvance() {
  if (aiOnlyOneLeft()) return;
  const active = aiGame.players.filter((player) => !player.folded);
  if (active.every((player) => player.allIn || player.folded) || aiShouldRunOutAllIn() && aiBettingRoundClosed()) {
    aiRunOutBoard();
    return aiShowdown();
  }
  if (aiBettingRoundClosed()) return aiNextStreet();
  aiGame.currentTurn = aiNextActiveIndex(aiGame.currentTurn);
}

function aiBettingRoundClosed() {
  return aiGame.players
    .filter((player) => !player.folded && !player.allIn)
    .every((player) => player.acted && player.bet === aiGame.currentBet);
}

function aiNextActiveIndex(from) {
  for (let step = 1; step <= aiGame.players.length; step++) {
    const index = (from + step + aiGame.players.length) % aiGame.players.length;
    const player = aiGame.players[index];
    if (!player.folded && !player.allIn) return index;
  }
  return -1;
}

function aiResetActionAfterRaise(raiserIndex) {
  aiGame.players.forEach((player, index) => {
    if (index !== raiserIndex && !player.folded && !player.allIn) {
      player.acted = false;
      player.raiseAllowed = true;
    }
  });
}

function aiNextStreet() {
  aiGame.players.forEach((player) => {
    player.bet = 0;
    player.acted = false;
    player.raiseAllowed = true;
  });
  aiGame.currentBet = 0;
  aiGame.minRaise = 20;
  if (aiGame.street === 0) {
    aiGame.deck.pop();
    aiGame.community.push(aiGame.deck.pop(), aiGame.deck.pop(), aiGame.deck.pop());
    aiGame.street = 1;
    aiLog("翻牌。");
  } else if (aiGame.street === 1) {
    aiGame.deck.pop();
    aiGame.community.push(aiGame.deck.pop());
    aiGame.street = 2;
    aiLog("转牌。");
  } else if (aiGame.street === 2) {
    aiGame.deck.pop();
    aiGame.community.push(aiGame.deck.pop());
    aiGame.street = 3;
    aiLog("河牌。");
  } else {
    aiShowdown();
    return;
  }
  aiGame.currentTurn = aiNextActiveIndex(aiGame.dealerIndex);
}

function aiShowdown() {
  const ranked = aiGame.players
    .filter((player) => !player.folded)
    .map((player) => ({ player, score: evaluateBest([...player.hand, ...aiGame.community]) }))
    .sort((a, b) => compareScores(b.score, a.score));
  const top = ranked[0];
  const tied = ranked.filter((entry) => compareScores(entry.score, top.score) === 0);
  const payouts = aiDistributePots();
  aiGame.handOver = true;
  aiGame.currentTurn = -1;
  aiGame.winners = tied.map((entry) => entry.player);
  const won = tied.reduce((sum, entry) => sum + (payouts.get(entry.player) || 0), 0);
  aiGame.resultText = `${tied.map((entry) => entry.player.name).join("、")} 凭 ${HAND_NAMES[top.score.rank]} 赢得 ${won}`;
  aiLog(`摊牌：${aiGame.resultText}。`);
}

function aiOnlyOneLeft() {
  const active = aiGame.players.filter((player) => !player.folded);
  if (active.length === 1) {
    active[0].stack += aiGame.pot;
    aiGame.handOver = true;
    aiGame.currentTurn = -1;
    aiGame.winners = [active[0]];
    aiGame.resultText = `${active[0].name} 赢得底池 ${aiGame.pot}`;
    aiLog(`${aiGame.resultText}。`);
    return true;
  }
  return false;
}

function aiShouldRunOutAllIn() {
  const active = aiGame.players.filter((player) => !player.folded);
  return active.some((player) => player.allIn) && active.filter((player) => !player.allIn).length <= 1;
}

function aiRunOutBoard() {
  if (aiGame.community.length === 0) {
    aiGame.deck.pop();
    aiGame.community.push(aiGame.deck.pop(), aiGame.deck.pop(), aiGame.deck.pop());
  }
  while (aiGame.community.length < 5) {
    aiGame.deck.pop();
    aiGame.community.push(aiGame.deck.pop());
  }
}

function aiDistributePots() {
  const payouts = new Map();
  const levels = [...new Set(aiGame.players.map((player) => player.contribution).filter((value) => value > 0))].sort((a, b) => a - b);
  let previous = 0;
  levels.forEach((level) => {
    const contributors = aiGame.players.filter((player) => player.contribution >= level);
    const amount = (level - previous) * contributors.length;
    const eligible = contributors.filter((player) => !player.folded);
    const ranked = eligible.map((player) => ({ player, score: evaluateBest([...player.hand, ...aiGame.community]) })).sort((a, b) => compareScores(b.score, a.score));
    const winners = ranked.filter((entry) => compareScores(entry.score, ranked[0].score) === 0);
    const share = Math.floor(amount / winners.length);
    let remainder = amount - share * winners.length;
    winners.forEach((entry) => {
      const extra = remainder-- > 0 ? 1 : 0;
      entry.player.stack += share + extra;
      payouts.set(entry.player, (payouts.get(entry.player) || 0) + share + extra);
    });
    previous = level;
  });
  return payouts;
}

function renderAi() {
  const me = aiGame.players[0];
  render({
    roomCode: "AI练习",
    maxPlayers: 4,
    players: aiGame.players.map((player, index) => ({
      name: player.name,
      stack: player.stack,
      bet: player.bet,
      folded: player.folded,
      allIn: player.allIn,
      connected: true,
      isMe: index === 0,
      isTurn: index === aiGame.currentTurn,
      isWinner: aiGame.winners?.includes(player),
      position: index === aiGame.dealerIndex && index === aiGame.smallBlindIndex ? "D/SB" : index === aiGame.dealerIndex ? "D" : index === aiGame.smallBlindIndex ? "SB" : index === aiGame.bigBlindIndex ? "BB" : "",
      hand: player.hand.map((card) => (index === 0 || aiGame.handOver && !player.folded) ? cardView(card) : { hidden: true })
    })),
    community: aiGame.community.map(cardView),
    pot: aiGame.pot,
    phase: aiGame.handOver ? "本手结束" : STREETS[aiGame.street],
    currentBet: aiGame.currentBet,
    minRaise: aiGame.minRaise,
    canAct: !aiGame.handOver && aiGame.currentTurn === 0 && !me.folded && !me.allIn,
    canRaise: me.raiseAllowed,
    isHost: true,
    resultText: aiGame.handOver ? aiGame.resultText : "",
    statusTitle: aiGame.handOver ? "AI 练习结束" : (aiGame.currentTurn === 0 ? "轮到你行动" : "AI 思考中"),
    statusText: aiGame.handOver ? "点击左上角开始按钮再来一手。" : "单人练习模式，电脑会自动行动。",
    log: aiGame.log.slice(0, 14)
  });
}

function aiPay(player, amount) {
  const paid = Math.min(player.stack, Math.max(0, amount));
  player.stack -= paid;
  player.bet += paid;
  player.contribution += paid;
  aiGame.pot += paid;
  if (player.stack === 0) player.allIn = true;
}

function aiLog(text) {
  aiGame.log.unshift(text);
}

function aiStrength(player) {
  const cards = [...player.hand, ...aiGame.community];
  if (cards.length >= 5) return evaluateBest(cards).rank / 8;
  const values = player.hand.map((card) => card.value).sort((a, b) => b - a);
  let score = (values[0] + values[1]) / 30;
  if (values[0] === values[1]) score += 0.32;
  if (player.hand[0].suit.key === player.hand[1].suit.key) score += 0.08;
  if (Math.abs(values[0] - values[1]) <= 2) score += 0.06;
  return Math.min(1, score);
}

function buildDeck() {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({ ...rank, suit })));
}

function shuffle(deck) {
  const copy = [...deck];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function cardView(card) {
  return { label: card.label, suit: card.suit.symbol, red: card.suit.red };
}

function randomStep(min, max) {
  return Math.round((min + Math.random() * (max - min)) / 10) * 10;
}

function evaluateBest(cards) {
  return choose(cards, 5).map(evaluateFive).sort(compareScores).at(-1);
}

function evaluateFive(cards) {
  const values = cards.map((card) => card.value).sort((a, b) => b - a);
  const counts = countBy(values);
  const groups = Object.entries(counts)
    .map(([value, count]) => ({ value: Number(value), count }))
    .sort((a, b) => b.count - a.count || b.value - a.value);
  const flush = cards.every((card) => card.suit.key === cards[0].suit.key);
  const straightHigh = getStraightHigh(values);
  if (flush && straightHigh) return score(8, [straightHigh]);
  if (groups[0].count === 4) return score(7, [groups[0].value, groups[1].value]);
  if (groups[0].count === 3 && groups[1].count === 2) return score(6, [groups[0].value, groups[1].value]);
  if (flush) return score(5, values);
  if (straightHigh) return score(4, [straightHigh]);
  if (groups[0].count === 3) return score(3, [groups[0].value, ...groups.slice(1).map((group) => group.value).sort((a, b) => b - a)]);
  if (groups[0].count === 2 && groups[1].count === 2) {
    const pairs = groups.filter((group) => group.count === 2).map((group) => group.value).sort((a, b) => b - a);
    return score(2, [...pairs, groups.find((group) => group.count === 1).value]);
  }
  if (groups[0].count === 2) return score(1, [groups[0].value, ...groups.slice(1).map((group) => group.value).sort((a, b) => b - a)]);
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

function renderCards(cards, visible, slots) {
  const rendered = cards.map((card) => visible && card ? renderCard(card) : `<div class="card back">?</div>`);
  while (rendered.length < slots) rendered.push(`<div class="card back">?</div>`);
  return rendered.join("");
}

function renderCard(card) {
  if (card.hidden) return `<div class="card back">?</div>`;
  return `<div class="card ${card.red ? "red" : ""}">${card.label}${card.suit}</div>`;
}

function getName() {
  const name = els.nameInput.value.trim() || `玩家${Math.floor(Math.random() * 90 + 10)}`;
  if (name.length > 12) throw new Error("昵称最多 12 个字。");
  return name;
}

async function copyLink() {
  if (appMode === "ai") {
    showError("AI 练习是本机单人模式。想邀请朋友，请返回选择“好友联机”。");
    return;
  }
  const roomCode = snapshot?.roomCode || session?.roomCode;
  if (!roomCode || roomCode === "未加入") {
    showLobby("还没有房间", "请先输入昵称并点击“创建房间”，生成房间号后再复制链接。");
    return;
  }
  const url = `${location.origin}${location.pathname}?room=${roomCode}`;
  try {
    await navigator.clipboard.writeText(url);
    showError("房间链接已复制。");
  } catch {
    showError(`复制失败时，直接把这个房间号发给朋友：${roomCode}`);
  }
}

function showError(message) {
  els.statusTitle.textContent = "提示";
  els.statusText.textContent = message;
}

function showLobby(title, text) {
  els.lobby.hidden = false;
  els.lobby.classList.toggle("online-mode", appMode === "online");
  els.roomCode.textContent = "未加入";
  els.copyLink.disabled = true;
  els.startHand.disabled = true;
  els.statusTitle.textContent = title;
  els.statusText.textContent = text;
  els.home.hidden = true;
}

function renderEmpty(title, text) {
  render({
    roomCode: appMode === "ai" ? "AI练习" : "未加入",
    maxPlayers: appMode === "ai" ? 4 : Number(els.maxPlayers.value || 4),
    players: [{ name: "你", stack: 0, bet: 0, hand: [], isMe: true, connected: true }],
    community: [],
    pot: 0,
    phase: "等待入座",
    currentBet: 0,
    canAct: false,
    isHost: false,
    statusTitle: title,
    statusText: text,
    log: []
  });
}

function clearSession() {
  if (source) source.close();
  source = null;
  session = null;
  localStorage.removeItem(STORAGE_KEY);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

els.aiMode.addEventListener("click", enterAiMode);
els.onlineMode.addEventListener("click", enterOnlineMode);
els.backToMode.addEventListener("click", backToModeSelect);
els.home.addEventListener("click", backToModeSelect);
els.playerCountOptions.forEach((button) => {
  button.addEventListener("click", () => {
    els.maxPlayers.value = button.dataset.count;
    document.body.dataset.maxPlayers = button.dataset.count;
    els.playerCountOptions.forEach((option) => option.classList.toggle("active", option === button));
  });
});
els.createRoom.addEventListener("click", createRoom);
els.joinRoom.addEventListener("click", joinRoom);
els.copyLink.addEventListener("click", copyLink);
els.startHand.addEventListener("click", startHand);
els.fold.addEventListener("click", () => sendAction("fold"));
els.call.addEventListener("click", () => sendAction("call"));
els.raise.addEventListener("click", () => sendAction("raise"));
els.allIn.addEventListener("click", () => sendAction("allin"));
els.raiseAmount.addEventListener("input", () => {
  els.raiseValue.textContent = els.raiseAmount.value;
  els.raise.textContent = `加注 +${els.raiseAmount.value}`;
});

if (appMode === "online") {
  els.lobby.classList.add("online-mode");
  renderEmpty("好友联机", "输入昵称后创建房间，或输入朋友给你的房间号加入。");
} else {
  renderEmpty("选择玩法", "选择 AI 练习或好友联机。");
}
