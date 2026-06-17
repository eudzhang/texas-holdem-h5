const $ = (id) => document.getElementById(id);
const els = {
  lobby: $("lobby"),
  nameInput: $("nameInput"),
  roomInput: $("roomInput"),
  createRoom: $("createRoomBtn"),
  joinRoom: $("joinRoomBtn"),
  copyLink: $("copyLinkBtn"),
  startHand: $("startHandBtn"),
  roomCode: $("roomCode"),
  opponents: $("opponents"),
  community: $("community"),
  playerHand: $("playerHand"),
  playerName: $("playerName"),
  playerStack: $("playerStack"),
  playerBet: $("playerBet"),
  pot: $("pot"),
  phase: $("phase"),
  statusTitle: $("statusTitle"),
  statusText: $("statusText"),
  fold: $("foldBtn"),
  call: $("callBtn"),
  raise: $("raiseBtn"),
  raiseAmount: $("raiseAmount"),
  raiseValue: $("raiseValue"),
  log: $("log")
};

const HAND_NAMES = ["高牌", "一对", "两对", "三条", "顺子", "同花", "葫芦", "四条", "同花顺"];
const STORAGE_KEY = "online-texas-room";
let session = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
let source;
let snapshot;

const urlRoom = new URLSearchParams(location.search).get("room");
if (urlRoom) els.roomInput.value = urlRoom.toUpperCase();
els.nameInput.value = localStorage.getItem("online-texas-name") || "";
if (session?.roomCode && session?.playerId) connect(session.roomCode, session.playerId);

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
    const name = getName();
    const data = await api("/api/create", { name });
    saveSession(data.roomCode, data.playerId, name);
    connect(data.roomCode, data.playerId);
  } catch (error) {
    showError(error.message);
  }
}

async function joinRoom() {
  try {
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
  source = new EventSource(`/events?room=${encodeURIComponent(roomCode)}&player=${encodeURIComponent(playerId)}`);
  source.addEventListener("state", (event) => {
    snapshot = JSON.parse(event.data);
    render(snapshot);
  });
  source.onerror = () => {
    els.statusTitle.textContent = "连接中断";
    els.statusText.textContent = "正在尝试重连。如果服务器刚启动，请稍等几秒。";
  };
}

async function sendAction(type) {
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
  if (!session) return;
  try {
    await api("/api/start", session);
  } catch (error) {
    showError(error.message);
  }
}

function render(data) {
  const me = data.players.find((player) => player.isMe);
  els.lobby.hidden = true;
  els.roomCode.textContent = data.roomCode;
  els.copyLink.disabled = false;
  els.startHand.disabled = !data.isHost || data.players.length < 2;
  els.startHand.title = data.isHost ? "开始新手牌" : "只有房主可以开始";
  els.opponents.innerHTML = data.players.filter((player) => !player.isMe).map(renderOpponent).join("");
  els.community.innerHTML = renderCards(data.community, true, 5);
  els.playerHand.innerHTML = renderCards(me?.hand || [], true, 2);
  els.playerName.textContent = me?.name || "你";
  els.playerStack.textContent = `筹码 ${me?.stack || 0}`;
  els.playerBet.textContent = `下注 ${me?.bet || 0}`;
  els.pot.textContent = data.pot;
  els.phase.textContent = data.phase;
  const need = Math.max(0, data.currentBet - (me?.bet || 0));
  els.call.textContent = need === 0 ? "过牌" : `跟注 ${need}`;
  const canAct = Boolean(data.canAct);
  els.fold.disabled = !canAct;
  els.call.disabled = !canAct;
  els.raise.disabled = !canAct || (me?.stack || 0) <= need;
  els.statusTitle.textContent = data.statusTitle;
  els.statusText.textContent = data.statusText;
  els.log.innerHTML = data.log.map((line) => `<p>${escapeHtml(line)}</p>`).join("");
}

function renderOpponent(player) {
  const stateClass = player.folded ? "folded" : "";
  const stateText = player.folded ? "已弃牌" : (player.allIn ? "全下" : player.connected ? "在线" : "离线");
  const turn = player.isTurn ? " turn" : "";
  return `
    <article class="seat${turn}">
      <div class="opponent-meta">
        <span class="name">${escapeHtml(player.name)}</span>
        <span class="stack">筹码 ${player.stack}</span>
        <span class="bet">下注 ${player.bet}</span>
        <span class="state ${stateClass}">${stateText}</span>
      </div>
      <div class="cards">${renderCards(player.hand, true, 2)}</div>
    </article>
  `;
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
  if (!session) return;
  const url = `${location.origin}${location.pathname}?room=${session.roomCode}`;
  try {
    await navigator.clipboard.writeText(url);
    showError("房间链接已复制。");
  } catch {
    showError(`房间号：${session.roomCode}`);
  }
}

function showError(message) {
  els.statusTitle.textContent = "提示";
  els.statusText.textContent = message;
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

els.createRoom.addEventListener("click", createRoom);
els.joinRoom.addEventListener("click", joinRoom);
els.copyLink.addEventListener("click", copyLink);
els.startHand.addEventListener("click", startHand);
els.fold.addEventListener("click", () => sendAction("fold"));
els.call.addEventListener("click", () => sendAction("call"));
els.raise.addEventListener("click", () => sendAction("raise"));
els.raiseAmount.addEventListener("input", () => {
  els.raiseValue.textContent = els.raiseAmount.value;
});

render({
  roomCode: "未加入",
  players: [{ name: "你", stack: 0, bet: 0, hand: [], isMe: true }],
  community: [],
  pot: 0,
  phase: "等待入座",
  currentBet: 0,
  canAct: false,
  isHost: false,
  statusTitle: "准备联机",
  statusText: "创建或加入房间后即可开始。部署到公网后，朋友打开同一个链接即可加入。",
  log: []
});
