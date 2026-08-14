
(() => {
"use strict";

const TIME_LIMIT = 60;
const TOTAL_STAGES = 10;
const DIFFS_PER_STAGE = 7;
const MAX_RANKINGS = 1000;
const NICK_KEY = "cat_time_attack_nickname_v2";
const PLAYER_NO_KEY = "cat_time_attack_player_no_v2";
const LOCAL_RANK_KEY = "cat_time_attack_local_rankings_v2";

const screens = ["menuScreen","readyScreen","playScreen","resultScreen","rankingScreen"];
const $ = id => document.getElementById(id);

let nickname = localStorage.getItem(NICK_KEY) || "";
let playerNo = Number(localStorage.getItem(PLAYER_NO_KEY) || 0) || null;
let supabaseClient = null;
let authReady = false;
let mode = "MENU";
let chosenCats = [];
let stageIndex = 0;
let startTimestamp = 0;
let remainingTime = TIME_LIMIT;
let currentCat = null;
let originalImage = null;
let diffs = [];
let found = [];
let foundCount = 0;
let readyTimer = null;
let animationFrame = null;
let resultSubmitted = false;

const originalCanvas = $("originalCanvas");
const diffCanvas = $("diffCanvas");
const octx = originalCanvas.getContext("2d");
const dctx = diffCanvas.getContext("2d");

function supabaseReady(){
  const cfg = window.APP_CONFIG || {};
  return !!(
    cfg.SUPABASE_URL &&
    cfg.SUPABASE_PUBLISHABLE_KEY &&
    window.supabase &&
    window.supabase.createClient
  );
}

function initSupabase(){
  if(!supabaseReady()) return;
  const cfg = window.APP_CONFIG;
  supabaseClient = window.supabase.createClient(
    cfg.SUPABASE_URL,
    cfg.SUPABASE_PUBLISHABLE_KEY
  );
}

function showScreen(id){
  screens.forEach(s => $(s).classList.toggle("active", s === id));

  // PLAY中だけ横向き最適化CSSを有効にする
  document.body.classList.toggle("playing-mode", id === "playScreen");

  window.scrollTo({top:0, behavior:"instant"});
}

function updateNicknameUI(){
  if(!nickname){
    $("currentName").textContent = "名前を設定";
    return;
  }
  $("currentName").textContent =
    playerNo ? `${nickname} / No.${playerNo}` : nickname;
}

async function ensureAnonymousSession(){
  if(!supabaseClient) return false;

  const {data:{session}, error:getError} =
    await supabaseClient.auth.getSession();

  if(getError) throw getError;

  if(session){
    authReady = true;
    return true;
  }

  const {error} = await supabaseClient.auth.signInAnonymously();
  if(error) throw error;

  authReady = true;
  return true;
}

async function loadMyPlayer(){
  if(!supabaseClient) return false;
  await ensureAnonymousSession();

  const {data, error} =
    await supabaseClient.rpc("get_my_cat_player");

  if(error) throw error;

  const row = Array.isArray(data) ? data[0] : null;

  if(!row){
    playerNo = null;
    localStorage.removeItem(PLAYER_NO_KEY);
    updateNicknameUI();
    return false;
  }

  nickname = row.nickname;
  playerNo = Number(row.player_no);

  localStorage.setItem(NICK_KEY, nickname);
  localStorage.setItem(PLAYER_NO_KEY, String(playerNo));

  updateNicknameUI();
  return true;
}

async function registerPlayer(name){
  if(!supabaseClient) return null;

  await ensureAnonymousSession();

  const {data, error} =
    await supabaseClient.rpc("register_cat_player", {
      p_nickname: name
    });

  if(error) throw error;

  const row = Array.isArray(data) ? data[0] : null;
  if(!row) throw new Error("参加者番号を取得できませんでした。");

  nickname = row.nickname;
  playerNo = Number(row.player_no);

  localStorage.setItem(NICK_KEY, nickname);
  localStorage.setItem(PLAYER_NO_KEY, String(playerNo));

  updateNicknameUI();
  return row;
}

function openNameModal(force=false){
  $("nicknameInput").value = nickname;
  $("privacyCheck").checked = false;
  $("nameError").textContent = "";
  $("nameModal").classList.add("open");
  if(force) $("nameModal").dataset.force = "1";
  else delete $("nameModal").dataset.force;
  setTimeout(() => $("nicknameInput").focus(), 100);
}

function nicknameProblem(name){
  const n = name.trim();
  const len = Array.from(n).length;
  if(len < 1) return "ニックネームを入力してください。";
  if(len > 12) return "ニックネームは12文字以内にしてください。";
  if(/[\r\n\t]/.test(n)) return "改行などは使えません。";
  if(/https?:\/\/|www\./i.test(n)) return "URLはニックネームに使えません。";
  if(/@/.test(n)) return "メールアドレスやSNS IDに見える文字列は使えません。";
  if(/\d[\d\-\s]{6,}\d/.test(n)) return "電話番号などに見える数字列は使えません。";
  if(/[<>]/.test(n)) return "「<」「>」は使えません。";
  return "";
}

async function saveNickname(){
  const n = $("nicknameInput").value.trim();
  const problem = nicknameProblem(n);

  if(problem){
    $("nameError").textContent = problem;
    return;
  }

  if(!$("privacyCheck").checked){
    $("nameError").textContent =
      "注意事項を確認してチェックを入れてください。";
    return;
  }

  $("nameError").textContent = "登録中…";
  $("saveNameBtn").disabled = true;

  try{
    if(supabaseClient){
      await registerPlayer(n);
    }else{
      nickname = n;
      localStorage.setItem(NICK_KEY, nickname);
      updateNicknameUI();
    }

    $("nameModal").classList.remove("open");
  }catch(err){
    console.error(err);
    $("nameError").textContent =
      "登録できませんでした。Supabaseの匿名ログイン設定を確認してください。";
  }finally{
    $("saveNameBtn").disabled = false;
  }
}

function sample(array, count){
  const a = [...array];
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a.slice(0,count);
}

function loadImage(src){
  return new Promise((resolve,reject)=>{
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function imagePath(catName){
  return `cats/${encodeURIComponent(catName)}.webp`;
}

function clearCanvas(ctx){
  ctx.clearRect(0,0,400,500);
  ctx.fillStyle = "#f1f3f4";
  ctx.fillRect(0,0,400,500);
}

function drawContained(ctx, img){
  clearCanvas(ctx);
  const ratio = Math.min(400/img.naturalWidth, 500/img.naturalHeight);
  const w = img.naturalWidth * ratio;
  const h = img.naturalHeight * ratio;
  const x = (400-w)/2;
  const y = (500-h)/2;
  ctx.drawImage(img,x,y,w,h);
  return {x,y,w,h};
}

function getPixelApproxColor(ctx,x,y){
  try{
    const p = ctx.getImageData(
      Math.max(0,Math.min(399,Math.round(x))),
      Math.max(0,Math.min(499,Math.round(y))),
      1,1
    ).data;
    return [p[0],p[1],p[2]];
  }catch{
    return [180,180,180];
  }
}

function targetColor(base, type){
  if(type === "vivid"){
    return [Math.min(255,base[0]+110), Math.max(0,base[1]-70), 0];
  }
  if(type === "subtle"){
    return [Math.max(0,base[0]-60), Math.max(0,base[1]-60), Math.min(255,base[2]+60)];
  }
  return base[0] < 180 ? [255,255,255] : [90,50,10];
}

function applyCustomDiff(ctx,x,y,size,type){
  const base = getPixelApproxColor(ctx,x,y);
  const c = targetColor(base,type);
  const grad = ctx.createRadialGradient(x,y,1,x,y,size);
  grad.addColorStop(0,`rgba(${c[0]},${c[1]},${c[2]},0.80)`);
  grad.addColorStop(0.45,`rgba(${c[0]},${c[1]},${c[2]},0.48)`);
  grad.addColorStop(1,`rgba(${c[0]},${c[1]},${c[2]},0)`);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x,y,size,0,Math.PI*2);
  ctx.fill();
}

function redrawDiff(){
  if(!originalImage) return;
  drawContained(dctx, originalImage);
  diffs.forEach((p,i)=>{
    applyCustomDiff(dctx,p.x,p.y,p.size,currentCat.type);
    if(found[i]){
      dctx.beginPath();
      dctx.strokeStyle = "#ff3c47";
      dctx.lineWidth = 5;
      dctx.arc(p.x,p.y,35,0,Math.PI*2);
      dctx.stroke();
    }
  });
}

async function setupStage(){
  currentCat = chosenCats[stageIndex];
  foundCount = 0;
  found = new Array(DIFFS_PER_STAGE).fill(false);
  diffs = [];
  originalImage = null;

  showScreen("readyScreen");
  $("readyStage").textContent = `STAGE ${stageIndex+1} / ${TOTAL_STAGES}`;
  $("readyName").textContent = currentCat.name;

  try{
    originalImage = await loadImage(imagePath(currentCat.name));
  }catch{
    $("readyName").innerHTML = "";
    const box = document.createElement("div");
    box.className = "missing";
    box.textContent = `画像「cats/${currentCat.name}.webp」が見つかりません。GitHubの cats フォルダにこの画像を追加してください。`;
    $("readyName").appendChild(box);
    setTimeout(() => endGame(false, "画像が見つからないため中断しました。"), 1800);
    return;
  }

  const rect = drawContained(octx, originalImage);
  drawContained(dctx, originalImage);

  const padding = 30;
  for(let i=0;i<DIFFS_PER_STAGE;i++){
    let candidate, tries=0;
    do{
      candidate = {
        x: Math.round(rect.x + padding + Math.random()*Math.max(1,rect.w-padding*2)),
        y: Math.round(rect.y + padding + Math.random()*Math.max(1,rect.h-padding*2)),
        size: 20 + Math.floor(Math.random()*11)
      };
      tries++;
    }while(
      tries < 50 &&
      diffs.some(p => Math.hypot(p.x-candidate.x,p.y-candidate.y) < 58)
    );
    diffs.push(candidate);
  }
  redrawDiff();

  if(readyTimer) clearTimeout(readyTimer);
  readyTimer = setTimeout(()=>{
    if(mode !== "RUNNING") return;
    showScreen("playScreen");
    renderPlayHeader();
  },1000);
}

async function startChallenge(){
  if(!nickname){
    openNameModal(true);
    return;
  }

  if(supabaseClient && !playerNo){
    try{
      await registerPlayer(nickname);
    }catch(err){
      console.error(err);
      openNameModal(true);
      $("nameError").textContent =
        "参加者登録が必要です。もう一度ニックネームを確認してください。";
      return;
    }
  }

  chosenCats = sample(window.CAT_DATA, TOTAL_STAGES);
  stageIndex = 0;
  remainingTime = TIME_LIMIT;
  resultSubmitted = false;
  mode = "RUNNING";
  startTimestamp = performance.now();
  setupStage();
  tick();
}

function renderPlayHeader(){
  $("progressText").textContent =
    `◆ ${stageIndex+1}/${TOTAL_STAGES} 匹目　残り汚れ: ${DIFFS_PER_STAGE-foundCount}`;
  $("catTitle").textContent = `— ${currentCat ? currentCat.name : ""} —`;
  $("tapHint").textContent = "汚れを見つけたら、右側の画像をタップ！";
  updateTimerUI();
}

function updateTimerUI(){
  $("timerText").textContent = `⏱ ${remainingTime.toFixed(2)}s`;
  $("timerText").classList.toggle("danger", remainingTime < 10);
  $("timeBar").style.width = `${Math.max(0,remainingTime/TIME_LIMIT*100)}%`;
  $("timeBar").style.background = remainingTime < 10 ? "#e66767" : "#8ec9ef";
}

function tick(){
  if(animationFrame) cancelAnimationFrame(animationFrame);
  const loop = ()=>{
    if(mode !== "RUNNING") return;
    const elapsed = (performance.now()-startTimestamp)/1000;
    remainingTime = Math.max(0,TIME_LIMIT-elapsed);
    updateTimerUI();
    if(remainingTime <= 0){
      endGame(false);
      return;
    }
    animationFrame = requestAnimationFrame(loop);
  };
  animationFrame = requestAnimationFrame(loop);
}

function pointerToCanvas(e, canvas){
  const r = canvas.getBoundingClientRect();
  return {
    x:(e.clientX-r.left)*(canvas.width/r.width),
    y:(e.clientY-r.top)*(canvas.height/r.height)
  };
}

function onDiffPointer(e){
  if(mode !== "RUNNING" || !originalImage) return;
  const p = pointerToCanvas(e,diffCanvas);

  for(let i=0;i<diffs.length;i++){
    if(found[i]) continue;
    const d = diffs[i];
    if(Math.hypot(p.x-d.x,p.y-d.y) < 42){
      found[i] = true;
      foundCount++;
      redrawDiff();
      renderPlayHeader();

      if(foundCount === DIFFS_PER_STAGE){
        if(stageIndex < TOTAL_STAGES-1){
          stageIndex++;
          setupStage();
        }else{
          endGame(true);
        }
      }
      return;
    }
  }
}

function getPrize(count){
  if(count >= 10) return "≪★ 特賞 ★≫";
  if(count === 9) return "◇◆ すごいで賞 ◆◇";
  if(count === 8) return "☆★ 天才で賞 ★☆";
  if(count === 7) return "♪♪ やったで賞 ♪♪";
  if(count === 6) return "▲▽ 頑張ったで賞 ▽▲";
  return "◇ 参加賞 ◇";
}

async function endGame(success, customMessage=""){
  if(mode === "RESULT") return;
  mode = "RESULT";
  if(animationFrame) cancelAnimationFrame(animationFrame);
  if(readyTimer) clearTimeout(readyTimer);

  const cleared = success ? TOTAL_STAGES : stageIndex;
  $("resultTitle").textContent = success
    ? "☆ 10匹すべてクリア！ ☆"
    : "◆ タイムアップ！ ◆";
  $("resultPrize").textContent = getPrize(cleared);

  if(customMessage){
    $("resultDetail").textContent = customMessage;
  }else if(success){
    $("resultDetail").textContent =
      `${nickname}${playerNo ? `（No.${playerNo}）` : ""} さんの記録：残り ${remainingTime.toFixed(2)} 秒`;
  }else{
    $("resultDetail").textContent =
      `クリアできた猫：${cleared} / ${TOTAL_STAGES} 匹`;
  }

  showScreen("resultScreen");

  if(success && !resultSubmitted){
    resultSubmitted = true;
    await submitScore(Math.round(remainingTime*100)/100);
  }
}

function getLocalRanks(){
  try{
    return JSON.parse(localStorage.getItem(LOCAL_RANK_KEY)||"[]") || [];
  }catch{
    return [];
  }
}

function saveLocalRank(name,time){
  let ranks = getLocalRanks();

  const existing = ranks.find(r => r.nickname === name);

  if(existing){
    existing.remaining_time =
      Math.max(Number(existing.remaining_time)||0, time);
  }else{
    ranks.push({
      nickname:name,
      player_no:null,
      remaining_time:time,
      created_at:new Date().toISOString()
    });
  }

  ranks.sort((a,b)=>b.remaining_time-a.remaining_time);
  localStorage.setItem(
    LOCAL_RANK_KEY,
    JSON.stringify(ranks.slice(0,MAX_RANKINGS))
  );
}

async function submitScore(time){
  if(!supabaseClient){
    saveLocalRank(nickname,time);
    return;
  }

  try{
    await ensureAnonymousSession();

    const {data,error} =
      await supabaseClient.rpc("submit_cat_score", {
        p_remaining_time: time
      });

    if(error) throw error;

    const row = Array.isArray(data) ? data[0] : null;
    if(row && row.player_no){
      playerNo = Number(row.player_no);
      localStorage.setItem(PLAYER_NO_KEY,String(playerNo));
      updateNicknameUI();
    }
  }catch(err){
    console.error("ranking update failed",err);
    saveLocalRank(nickname,time);
  }
}

async function loadRankings(){
  showScreen("rankingScreen");
  $("rankList").innerHTML =
    '<div class="rank-loading">ランキング読み込み中…</div>';

  let ranks = [];

  if(supabaseClient){
    try{
      await ensureAnonymousSession();

      const {data,error} =
        await supabaseClient.rpc("get_cat_ranking", {
          p_limit: MAX_RANKINGS
        });

      if(error) throw error;
      ranks = data || [];
    }catch(err){
      console.error("ranking read failed",err);
      ranks = getLocalRanks();
    }
  }else{
    ranks = getLocalRanks();
  }

  renderRankings(ranks);
}

function renderRankings(ranks){
  const box = $("rankList");
  box.innerHTML = "";

  if(!ranks.length){
    box.innerHTML =
      '<div class="rank-empty">まだ記録がありません。最初のランカーになろう！</div>';
    return;
  }

  ranks.forEach((r,i)=>{
    const row = document.createElement("div");
    row.className = "rank-row";

    const pos = document.createElement("div");
    pos.className =
      "rank-pos " +
      (i===0?"gold":i===1?"silver":i===2?"bronze":"");
    pos.textContent = `${i+1}.`;

    const name = document.createElement("div");
    name.className = "rank-name";
    name.textContent =
      r.player_no
        ? `${r.nickname}  ・ No.${r.player_no}`
        : r.nickname;

    const time = document.createElement("div");
    time.className = "rank-time";
    time.textContent =
      `${Number(r.best_remaining_time ?? r.remaining_time).toFixed(2)}s`;

    row.append(pos,name,time);
    box.appendChild(row);
  });
}

function refreshRankingMode(){
  $("rankingMode").innerHTML = supabaseClient
    ? "🌐 一人1件の自己ベスト方式・参加者番号つきオンラインランキング"
    : '<span class="offline-badge">設定前：この端末だけのローカルランキング</span>';
}

$("diffCanvas").addEventListener("pointerdown",onDiffPointer);
$("startBtn").addEventListener("click",startChallenge);
$("rankingBtn").addEventListener("click",loadRankings);
$("resultRankingBtn").addEventListener("click",loadRankings);
$("backMenuBtn").addEventListener("click",()=>{mode="MENU";showScreen("menuScreen")});
$("rankBackBtn").addEventListener("click",()=>{mode="MENU";showScreen("menuScreen")});
$("changeNameBtn").addEventListener("click",()=>openNameModal(false));
$("saveNameBtn").addEventListener("click",saveNickname);
$("nicknameInput").addEventListener("keydown",e=>{
  if(e.key==="Enter") saveNickname();
});

async function bootstrap(){
  initSupabase();
  updateNicknameUI();

  if(supabaseClient){
    try{
      await ensureAnonymousSession();
      const exists = await loadMyPlayer();

      // 既存の匿名ユーザーに参加者情報がない場合は
      // 改めて注意事項を確認してもらう。
      if(!exists){
        openNameModal(true);
      }
    }catch(err){
      console.error("Supabase auth initialization failed",err);
      if(!nickname){
        openNameModal(true);
      }
    }
  }else if(!nickname){
    openNameModal(true);
  }

  refreshRankingMode();
}

bootstrap();

if("serviceWorker" in navigator){
  window.addEventListener("load",()=>{
    navigator.serviceWorker.register("./sw.js").catch(()=>{});
  });
}
})();
