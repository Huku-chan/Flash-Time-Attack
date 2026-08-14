// ============================================================
// Supabase接続設定
// ============================================================
// Authentication > Anonymous Sign-Ins を ON にしてください。
//
// ブラウザに置くのは Project URL と Publishable key だけです。
// Secret key / service_role key は絶対にここへ入れないでください。
window.APP_CONFIG = {
  SUPABASE_URL: "",
  SUPABASE_PUBLISHABLE_KEY: "",
  ONLINE_RANKING: false,

  // true: Supabase Anonymous Authを使用。
  // ONLINE_RANKING=true のときは true のまま使ってください。
  USE_ANONYMOUS_AUTH: true
};
