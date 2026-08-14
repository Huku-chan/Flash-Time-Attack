# フラッシュ暗算 Web / スマホ版

元の pygame 版 `flush_yellow01.py` のルールをベースにした、
スマホの Safari / Chrome から遊べる Web/PWA 版です。

## 入っているもの

- レスポンシブスマホ画面
- 数字キー入力（スマホでは数字キーボード）
- Lv.1〜50
- 元コードと同じ難易度式
  - 個数: `min(3 + (Lv-1)//2, 25)`
  - 間隔: `max(0.85 - (Lv-1)*0.015, 0.12)`
- 10秒回答
- 敵HP / プレイヤーHP / Final Boss
- 正解・不正解演出
- ニックネームランキング
- 個人情報をニックネームに入れない注意 + 確認チェック必須
- 端末内自動保存
- JSONバックアップ書き出し / 読み込み
- PWA manifest + Service Worker
- GitHub Pages向け静的ファイル
- Supabaseオンラインランキング接続
- オンラインランキング未設定でも端末内ランキングで遊べる

## 1. まずPCで試す

`index.html` を直接開くのではなく、簡易HTTPサーバーを使うのがおすすめです。

Windows PowerShell / Terminal:

```bash
cd FlashMentalWeb
python -m http.server 8000
```

ブラウザで:

```text
http://localhost:8000
```

## 2. GitHub PagesでURL公開

このフォルダの中身をGitHubリポジトリへアップロードします。

例:

```text
flash-mental/
  index.html
  style.css
  app.js
  config.js
  manifest.webmanifest
  service-worker.js
  icons/
  supabase_schema.sql
```

GitHub:
1. Repository → Settings
2. Pages
3. Build and deployment
4. Source: Deploy from a branch
5. `main` / `/ (root)` を選択
6. Save

公開されると、たとえば:

```text
https://あなたのGitHub名.github.io/flash-mental/
```

のようなURLでアクセスできます。

## 3. オンラインランキングを有効化

### Supabase側

1. SupabaseでProject作成
2. SQL Editorを開く
3. `supabase_schema.sql` の中身を実行
4. Project URL を確認
5. Publishable key (`sb_publishable_...`) を確認

### Web側

`config.js`:

```js
window.APP_CONFIG = {
  SUPABASE_URL: "https://xxxxxxxx.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_xxxxxxxxx",
  ONLINE_RANKING: true
};
```

**Secret key / service_role key はブラウザコードに絶対に入れないでください。**

その後、GitHubに `config.js` をpushします。

## ニックネームについて

入力画面に次の注意を表示しています。

> 公開ランキングに表示されます。
> 氏名・学校名・勤務先・SNS ID・住所・誕生日など、
> 個人の特定につながる情報をニックネームに入れないでください。

さらに確認チェックをONにしないとゲームを開始できません。

## バックアップ

バックアップ画面からJSONを書き出せます。

保存対象:
- ニックネーム
- ベストLv
- 最近のプレイ履歴
- 文字サイズ / 効果音 / バイブ設定
- 中断中プレイ
- 端末内ランキング

別スマホでJSONを読み込めば復元できます。

公平性のため、
**JSONから復元した途中プレイはオンラインランキング送信対象外**にしています。

## アンチチートについて

このWeb版のランキングは、まず使いやすさを優先した
「ログイン不要のカジュアルランキング」です。

ブラウザJavaScriptは利用者が内容を変更できるので、
公開キー + RLSだけで「絶対に改ざんできないランキング」にはできません。

本格的に順位の信頼性を上げる場合は次の段階で:

- サーバーが問題列を発行
- 回答を1問ごとにサーバーで検証
- サーバーだけが最終Lvを確定
- 1プレイごとのrun token
- 異常な回答速度・重複送信・大量送信を検出

という方式にします。

## 画像・音

今回渡された `flush_yellow01.py` は
`goblin.png`, `boss.png`, `hit.mp3`, `miss.mp3`, `ready.wav`
を別ファイルから読み込む構造でした。

それらの素材自体は今回の添付に含まれていなかったので、
このWeb版はまず絵文字 + Web Audioの簡易効果音で、
単独でも動くようにしてあります。

あとで元画像・元音源を同じプロジェクトへ追加して差し替え可能です。


# Version 2 改良点

## ニックネーム重複OK

`nickname` は表示名だけです。DBの主キーやユーザー識別には使いません。

内部では各ブラウザに:

- `anonymous_player_id` … プレイヤーを区別するランダムUUID
- `run_id` … 1プレイごとのランダムUUID

を生成します。

例:

```text
表示名        anonymous_player_id
ねこ          10cf...   ← Aさん
ねこ          8a21...   ← Bさん
ねこ          c702...   ← Cさん
```

ランキングには全員「ねこ」と表示できますが、内部では別プレイヤーです。

このIDはゲーム自身が乱数で作るもので、
スマホのIMEI・シリアル番号・広告IDなどのハードウェア識別子ではありません。

## 1プレイヤー1ベスト記録

DBにはプレイ履歴を追加していきますが、
公開ランキングでは `anonymous_player_id` ごとの最高Lvだけを表示します。

そのため同じ人が何十回遊んでもランキングを何十枠も埋めません。
一方で、同じニックネームを使う別人は普通に別々にランキングへ載ります。

## 二重送信対策

`run_id` に UNIQUE 制約があります。

通信リトライなどで同じプレイ結果が2回POSTされても、
同じ run_id は重複登録されません。

## 内部IDをランキング画面へ公開しない

生の `flash_scores` テーブルには `player_id` / `run_id` がありますが、
ブラウザには生テーブルのSELECT権限を与えていません。

ランキング取得は `get_flash_ranking()` RPCだけを使い、
返すのは:

- nickname
- level
- created_at

のみです。

## バックアップと機種変更

バックアップJSONには匿名プレイヤーIDも含めます。
自分の新しいスマホへバックアップを読み込むと、
オンラインランキング上も同じプレイヤーとして扱えます。

ただし、復元された「プレイ途中データ」はランキング送信不可です。

## 元ゲーム素材

今回受け取った元の `flush.zip` からWeb版へ次を組み込みました。

- goblin.png
- goblin_angry.png
- goblin_dying.png
- goblin4.png
- boss.png
- lumine.png
- ready.wav
- go.wav
- correct.mp3
- wrong.mp3
- enemy_death.mp3
- miss.mp3
- Hit-Punch02-5(Delay).mp3 → Web版では hit.mp3
- boss_bgm.mp3

通常敵のHPが半分以下になると怒り画像、
撃破時は瀕死画像、Lv.50ではボス画像とボスBGM、
クリア時にはルミネ姫画像が表示されます。

## Supabaseをすでに旧SQLで作った場合

まだテスト段階でデータを消してよければ、
Supabase側の古い `flash_scores` を削除してから
このVersion 2の `supabase_schema.sql` を実行するのが簡単です。

既存ランキングを残したい場合は、
テーブル移行SQLを別途作る必要があります。


# Version 3: Supabase Anonymous Auth

オンラインランキングの内部プレイヤー識別を、
ゲーム独自UUIDから Supabase Anonymous Auth の `auth.uid()` に変更しました。

## 初回アクセス

ONLINE_RANKING=true のとき:

1. Supabaseの既存sessionを確認
2. sessionがなければ `signInAnonymously()`
3. Supabaseが匿名ユーザーID + sessionを発行
4. 同じブラウザではsessionを保持
5. ランキング投稿時は `player_id = auth.uid()`

## RLS

INSERTポリシーは:

```sql
to authenticated
with check (
  player_id = (select auth.uid())
  ...
)
```

です。

Supabase Authの匿名ユーザーはDatabase上では
`authenticated` roleとして扱われます。

そのため未ログインの `anon` roleはスコアを書けません。

## ニックネーム重複

nicknameは識別に使っていません。

```text
Supabase user A -> "ねこ"
Supabase user B -> "ねこ"
Supabase user C -> "ねこ"
```

すべて別プレイヤーとして保存できます。

公開ランキングは `auth.uid()` ごとにベスト1件だけ表示します。

## バックアップ

認証session・access token・refresh tokenは
バックアップJSONに書き出しません。

そのため:

- 同じ端末 / 同じブラウザ → 通常は同じ匿名ユーザー
- ブラウザデータを削除 → 新しい匿名ユーザー
- 別スマホ → 新しい匿名ユーザー
- バックアップ復元 → ゲーム進行は戻るがランキングidentityは新しくなる

これは匿名認証の性質に合わせた安全な動作です。

もし将来、
「機種変更してもランキング上の同じ本人として完全に引き継ぐ」
必要が出たら、匿名ユーザーをApple / Google / メール等の
恒久アカウントへリンクする機能を追加します。

## Supabase設定

Dashboard:

```text
Authentication
→ Anonymous Sign-Ins
→ Allow anonymous sign-ins = ON
```

SQL Editor:

`supabase_schema.sql` を実行。

Web側:

`config.js`

```js
window.APP_CONFIG = {
  SUPABASE_URL: "https://xxxxx.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_xxxxx",
  ONLINE_RANKING: true,
  USE_ANONYMOUS_AUTH: true
};
```

Secret key / service_role key は入れません。

## 公開前に推奨

匿名サインインはbotで大量作成される可能性があるため、
一般公開前にはSupabase Auth側でCAPTCHA
（Cloudflare Turnstile等）を追加するのがおすすめです。
