import pygame
import random
import sys
import time
import csv
import os

# ================= 1. 初期化 =================
pygame.init()
pygame.mixer.init()

WIDTH, HEIGHT = 900, 600
screen = pygame.display.set_mode((WIDTH, HEIGHT))
pygame.display.set_caption("ルミネ姫救出大作戦 - イエロー進軍Edition (Anti-Cheat)")

clock = pygame.time.Clock()

# --- フォント設定 ---
font_name = "meiryo" if "meiryo" in pygame.font.get_fonts() else None
font = pygame.font.SysFont(font_name, 28)
mid_font = pygame.font.SysFont(font_name, 40)
big_font = pygame.font.SysFont(font_name, 80, bold=True)
huge_font = pygame.font.SysFont(font_name, 200, bold=True) 

# --- カラー定義 ---
WHITE, BLACK = (255, 255, 255), (20, 20, 20)
RED, GREEN, BLUE = (220, 60, 60), (50, 200, 50), (50, 100, 250)
GOLD = (180, 140, 0)
DEEP_RED = (150, 0, 0)
TIMER_BLUE = (0, 150, 255)

BG_YELLOW_NORMAL = (255, 230, 0)
BG_YELLOW_BOSS   = (255, 200, 0)
BG_YELLOW_INPUT  = (255, 245, 100)

# ================= 2. 素材ロード =================
def load_img(path, size):
    try: return pygame.transform.scale(pygame.image.load(path), size)
    except:
        surf = pygame.Surface(size); surf.fill((200, 200, 200)); return surf

goblin_img = load_img("goblin.png", (260, 260))
boss_img = load_img("boss.png", (320, 320))

def load_sound(path):
    try: return pygame.mixer.Sound(path)
    except: return None

hit_se = load_sound("hit.mp3")
miss_se = load_sound("miss.mp3")
ready_se = load_sound("ready.wav")

# ================= 3. ランキング機能 =================
RANKING_FILE = "ranking_yellow.csv"

def save_score(name, lv):
    scores = load_ranking()
    scores.append({"name": name, "level": str(lv), "edition": "yellow"})
    scores.sort(key=lambda x: int(x["level"]), reverse=True)
    with open(RANKING_FILE, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["name", "level", "edition"])
        # ★変更: 最大1000位まで保存できるように拡張
        writer.writerows(scores[:1000])

def load_ranking():
    if not os.path.exists(RANKING_FILE): return []
    with open(RANKING_FILE, "r", encoding="utf-8") as f:
        return list(csv.DictReader(f, fieldnames=["name", "level", "edition"]))

# ================= 4. ゲーム管理変数 =================
level = 1
player_hp, PLAYER_MAX_HP = 100, 100
enemy_hp, ENEMY_MAX_HP = 100, 100
boss_hp, BOSS_MAX_HP = 600, 600
player_name = "勇者"
input_text = ""
game_state = -1 

nums, answer, show_index = [], 0, 0
last_flash, flash_interval = 0, 0.85
show_question, is_waiting_for_ready = False, False
wait_start_time, is_blank_time, READY_DELAY = 0, False, 0
is_lingering, linger_start_time = False, 0
is_correct_hit = False 
correct_answer_show_start = 0
prev_game_state = 0

LIMIT_TIME = 10.0
answer_start_time = 0

# ★追加: スクロール制御用の変数
scroll_y = 0

# ================= 5. ロジック関数 =================
def get_difficulty(lv):
    count = min(3 + (lv - 1) // 2, 25)
    interval = max(0.85 - ((lv - 1) * 0.015), 0.12)
    return 1, count, interval

def new_question():
    global nums, answer, show_index, show_question, flash_interval, is_waiting_for_ready, wait_start_time, input_text, READY_DELAY, is_lingering
    input_text = ""
    _, count, flash_interval = get_difficulty(level)
    nums = [random.randint(1, 9) for _ in range(count)]
    answer = sum(nums)
    show_index, is_waiting_for_ready, wait_start_time, show_question = 0, True, time.time(), False
    is_lingering = False
    if ready_se:
        ready_se.play()
        READY_DELAY = max(0, ready_se.get_length() - 1.8)
    else: READY_DELAY = 0.5

def draw_gauge(x, y, w, h, curr, maxi, color, bg_color=(80, 80, 0)):
    pygame.draw.rect(screen, bg_color, (x, y, w, h))
    pygame.draw.rect(screen, color, (x, y, max(0, int(w * curr / maxi)), h))
    pygame.draw.rect(screen, BLACK, (x, y, w, h), 2)

# ================= 6. メインループ =================
running = True
temp_name = ""

while running:
    if level >= 50 and game_state in (0, 1, 4): screen.fill(BG_YELLOW_BOSS)
    elif game_state == -1: screen.fill(BG_YELLOW_INPUT)
    elif game_state == 5: screen.fill(BLACK) # ランキング時は黒背景
    else: screen.fill(BG_YELLOW_NORMAL)
        
    now = time.time()

    for event in pygame.event.get():
        if event.type == pygame.QUIT: running = False
        
        # ★追加: マウスホイールによるスクロールイベント
        if event.type == pygame.MOUSEBUTTONDOWN and game_state == 5:
            if event.button == 4:    # ホイール上
                scroll_y = max(0, scroll_y - 40)
            elif event.button == 5:  # ホイール下
                scroll_y += 40

        if event.type == pygame.KEYDOWN:
            # --- 名前入力画面 ---
            if game_state == -1:
                if event.key == pygame.K_RETURN and temp_name != "":
                    player_name = temp_name
                    scroll_y = 0 # 初期化
                    level = 1; player_hp = PLAYER_MAX_HP; enemy_hp = ENEMY_MAX_HP; game_state = 0; new_question()
                elif event.key == pygame.K_BACKSPACE: temp_name = temp_name[:-1]
                else:
                    if len(temp_name) < 8 and event.unicode.isprintable(): temp_name += event.unicode
            
            # --- 戦闘中の入力ロジック ---
            elif game_state in (0, 1):
                if is_waiting_for_ready or show_question or is_lingering:
                    continue
                
                if event.key in (pygame.K_RETURN, pygame.K_SPACE):
                    if input_text == "": continue
                    try:
                        if int(input_text) == answer:
                            dmg = random.randint(35, 50) + level
                            if hit_se: hit_se.play()
                            if game_state == 0: enemy_hp -= dmg
                            else: boss_hp -= dmg
                            is_correct_hit = True
                        else:
                            if miss_se: miss_se.play()
                            player_hp -= 15; is_correct_hit = False
                    except: is_correct_hit = False
                    prev_game_state = game_state; game_state = 4; correct_answer_show_start = now
                elif event.key == pygame.K_BACKSPACE: input_text = input_text[:-1]
                elif event.unicode.isdigit() and len(input_text) < 6: input_text += event.unicode

            # --- ランキング画面（キー単発押し用） ---
            elif game_state == 5:
                if event.key == pygame.K_UP:
                    scroll_y = max(0, scroll_y - 30)
                elif event.key == pygame.K_DOWN:
                    scroll_y += 30

    # ★追加: 上下キー押しっぱなしによる高速スクロール処理
    if game_state == 5:
        keys = pygame.key.get_pressed()
        if keys[pygame.K_UP]:
            scroll_y = max(0, scroll_y - 12)
        if keys[pygame.K_DOWN]:
            scroll_y += 12

    # --- フラッシュ表示ロジック ---
    if game_state in (0, 1):
        if is_waiting_for_ready and now - wait_start_time > READY_DELAY:
            is_waiting_for_ready, show_question, last_flash = False, True, now
        
        if show_question:
            elapsed = now - last_flash
            if show_index < len(nums):
                if elapsed > flash_interval: 
                    last_flash, show_index = now, show_index + 1
                    is_blank_time = False
                    if show_index == len(nums): is_lingering = True; linger_start_time = now
                elif elapsed > flash_interval * 0.85: is_blank_time = True
                else: is_blank_time = False
            
            if is_lingering and now - linger_start_time > 0.8:
                show_question = False
                is_lingering = False
                answer_start_time = now
                input_text = ""
                pygame.event.clear(pygame.KEYDOWN)

    # --- 描画ロジック ---
    if game_state == -1:
        t = mid_font.render("勇者の名前を入力して進軍開始:", True, BLACK)
        screen.blit(t, (WIDTH//2-t.get_width()//2, 200))
        n = big_font.render(temp_name + "_", True, DEEP_RED)
        screen.blit(n, (WIDTH//2-n.get_width()//2, 280))
    
    elif game_state in (0, 1):
        screen.blit(font.render(f"Lv.{level} {player_name}", True, BLACK), (50, 15))
        draw_gauge(50, 50, 200, 25, player_hp, PLAYER_MAX_HP, GREEN, (50, 50, 50))
        
        cx = WIDTH // 2 - 150
        if is_waiting_for_ready:
            ready_txt = mid_font.render("READY?", True, BLACK)
            screen.blit(ready_txt, (cx - ready_txt.get_width()//2, 250))
        elif show_question and show_index > 0 and not is_blank_time:
            num_txt = huge_font.render(str(nums[show_index - 1]), True, BLACK)
            screen.blit(num_txt, (cx - num_txt.get_width()//2, 180))
        elif not show_question and not is_waiting_for_ready:
            elapsed_answer = now - answer_start_time
            remaining = max(0, LIMIT_TIME - elapsed_answer)
            if remaining <= 0:
                if miss_se: miss_se.play()
                player_hp -= 15; is_correct_hit = False; prev_game_state = game_state; game_state = 4; correct_answer_show_start = now
            
            ans_p = font.render(f"残り {remaining:.1f}秒", True, BLACK)
            screen.blit(ans_p, (cx - ans_p.get_width()//2, 130))
            
            time_color = TIMER_BLUE if remaining > 3 else RED
            draw_gauge(cx - 125, 175, 250, 15, remaining, LIMIT_TIME, time_color, (255, 255, 255))
            
            ans_v = huge_font.render(input_text, True, BLUE)
            screen.blit(ans_v, (cx - ans_v.get_width()//2, 200))
        
        if game_state == 0:
            screen.blit(goblin_img, (550, 250))
            draw_gauge(550, 220, 260, 20, enemy_hp, ENEMY_MAX_HP, RED, (50, 50, 50))
        else:
            screen.blit(boss_img, (520, 220))
            draw_gauge(520, 190, 320, 25, boss_hp, BOSS_MAX_HP, RED, (50, 50, 50))
            screen.blit(font.render("FINAL BOSS", True, DEEP_RED), (520, 160))

    elif game_state == 4: # 判定表示
        center_pos = (WIDTH // 2, HEIGHT // 2 + 20)
        if is_correct_hit: pygame.draw.circle(screen, GREEN, center_pos, 180, 25)
        else:
            pygame.draw.line(screen, DEEP_RED, (center_pos[0]-150, center_pos[1]-150), (center_pos[0]+150, center_pos[1]+150), 35)
            pygame.draw.line(screen, DEEP_RED, (center_pos[0]+150, center_pos[1]-150), (center_pos[0]-150, center_pos[1]+150), 35)
        ans_t = huge_font.render(f"{answer}", True, BLACK)
        screen.blit(ans_t, (WIDTH//2 - ans_t.get_width()//2, 200))
        if now - correct_answer_show_start > 1.2:
            if (prev_game_state == 0 and enemy_hp <= 0) or (prev_game_state == 1 and boss_hp <= 0):
                game_state = 2; last_flash = now
            elif player_hp > 0: game_state = prev_game_state; new_question() 
            else: save_score(player_name, level); game_state = 5

    elif game_state == 2: # レベルアップ
        msg = f"LEVEL UP! -> {level + 1}" if level < 50 else "WORLD PEACE!!"
        vic = big_font.render(msg, True, BLUE)
        screen.blit(vic, (WIDTH//2 - vic.get_width()//2, 200))
        if now - last_flash > 1.5:
            if level >= 50: save_score(player_name, level); game_state = 5
            else:
                level += 1; player_hp = min(PLAYER_MAX_HP, player_hp + 20)
                if level == 50: game_state = 1
                else: enemy_hp = ENEMY_MAX_HP; game_state = 0
                new_question()

    elif game_state == 5: # ★変更: 1000件対応スクロールランキング画面
        scores = load_ranking()
        
        # 登録データ件数に基づいて動的に最大スクロール可能範囲を計算
        max_scroll = max(0, len(scores) * 50 - 330)
        if scroll_y > max_scroll:
            scroll_y = max_scroll

        # 最大1000件をレンダリングするための仮想サーフェスを構築
        list_surf = pygame.Surface((WIDTH, max(400, len(scores) * 50)), pygame.SRCALPHA)
        
        # ★最大1000位までのテキストを一括で描画
        for i, s in enumerate(scores[:1000]):
            rank_txt = font.render(f"{i+1}位: {s['name']} - Lv.{s['level']}", True, WHITE)
            list_surf.blit(rank_txt, (WIDTH//2 - rank_txt.get_width()//2, i * 50))
            
        # 表示領域（Y:150〜480）に切り取って反映
        screen.blit(list_surf, (0, 150), (0, scroll_y, WIDTH, 330))

        # データが多いときに操作ガイドテキストを出す
        if len(scores) > 6:
            scroll_info = font.render("▲▼ / ホイールでスクロール", True, GOLD)
            screen.blit(scroll_info, (WIDTH//2 - scroll_info.get_width()//2, 490))

        # ヘッダーとフッターを独立して描画
        txt = big_font.render("YELLOW RANKING (TOP 1000)", True, (255, 230, 0))
        screen.blit(txt, (WIDTH//2-txt.get_width()//2, 30))
        
        exit_t = font.render("SPACEキーで終了", True, RED)
        screen.blit(exit_t, (WIDTH//2-exit_t.get_width()//2, 535))
        
        if pygame.key.get_pressed()[pygame.K_SPACE]: running = False

    pygame.display.flip()
    clock.tick(60)

pygame.quit()
sys.exit()