/**
 * Solara Google Drive sync (Apps Script)
 *
 * 用法：
 * 1. https://script.google.com 開新專案，貼上呢段碼
 * 2. 專案設定 → 指令碼屬性：加 SOLARA_TOKEN（自訂密碼）
 * 3. 部署 → 新部署 → 網頁應用程式
 *    - 執行身分：我
 *    - 可存取對象：任何擁有連結嘅人
 * 4. 複製 Web App URL，貼去 Solara → 設定 → 進階／舊版同步
 *
 * 會喺你 Drive 根目錄建立／更新 solara-backup.json
 */

var FILE_NAME = "solara-backup.json";

function doGet(e) {
  if (!checkToken_(e)) return json_({ ok: false, error: "unauthorized" });
  var file = findFile_();
  if (!file) return json_({ ok: true, data: null, updatedAt: 0 });
  return json_({
    ok: true,
    data: JSON.parse(file.getBlob().getDataAsString()),
    updatedAt: file.getLastUpdated().getTime()
  });
}

function doPost(e) {
  if (!checkToken_(e)) return json_({ ok: false, error: "unauthorized" });
  var body = {};
  try {
    body = JSON.parse((e.postData && e.postData.contents) || "{}");
  } catch (err) {
    return json_({ ok: false, error: "bad_json" });
  }
  var mode = String((e.parameter && e.parameter.mode) || body.mode || "merge");
  if (mode === "delete") {
    var old = findFile_();
    if (old) old.setTrashed(true);
    return json_({ ok: true, deleted: true });
  }
  if (!body.data) return json_({ ok: false, error: "missing_data" });
  writeFile_(JSON.stringify(body.data));
  return json_({ ok: true, savedAt: Date.now() });
}

function checkToken_(e) {
  var expected = PropertiesService.getScriptProperties().getProperty("SOLARA_TOKEN");
  if (!expected) return false;
  var got = (e && e.parameter && e.parameter.token) || "";
  return String(got) === String(expected);
}

function findFile_() {
  var it = DriveApp.getFilesByName(FILE_NAME);
  return it.hasNext() ? it.next() : null;
}

function writeFile_(text) {
  var file = findFile_();
  if (file) {
    file.setContent(text);
    return file;
  }
  return DriveApp.createFile(FILE_NAME, text, MimeType.PLAIN_TEXT);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
