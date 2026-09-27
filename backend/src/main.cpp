// EduCAD C++ backend: static file server for mirror/ + JSON API.
// Mirrors tools/serve.js behavior (routes, status codes, JSON shapes).
//
//   educad-server [port]   (default 8124; $PORT fallback; +10 busy retry)
//   env: EDUCAD_ROOT (default <exe>/../../mirror)
//        EDUCAD_DB   (default <exe>/../data/educad.db, outside served root)
//
// Static files + auth (POST /api/login, POST /api/logout, GET /api/me)
// + saves (GET/POST /api/drawings, GET/PUT/DELETE /api/drawings/:id,
// GET /api/progress, PUT /api/progress/:lesson).

#include <algorithm>
#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <mutex>
#include <string>
#include <vector>

#include "httplib.h"
#include "json.hpp"
#include "sqlite3.h"
#include "sodium.h"
#include "schema.h"

#ifdef __linux__
#include <unistd.h>
#endif
#ifndef _WIN32
#include <sys/socket.h>
#endif

namespace fs = std::filesystem;
using nlohmann::json;

namespace {

const char *kHost = "127.0.0.1";
const int kDefaultPort = 8124;
const int kMaxBindAttempts = 10;
const size_t kLoginMaxBody = 4096;
const size_t kSaveMaxBody = 1024 * 1024;
const long kSessionTtlSec = 24 * 3600;
const std::vector<std::string> kRoles = {"academics", "teacher", "student"};

std::string toLowerAscii(std::string s) {
  for (auto &c : s) c = (char)tolower((unsigned char)c);
  return s;
}

std::string trimWs(const std::string &s) {
  size_t a = 0, b = s.size();
  while (a < b && isspace((unsigned char)s[a])) a++;
  while (b > a && isspace((unsigned char)s[b - 1])) b--;
  return s.substr(a, b - a);
}

// Percent-decode; false on invalid encoding (serve.js resolvePath: 400).
bool pctDecode(const std::string &in, std::string *out) {
  out->clear();
  out->reserve(in.size());
  for (size_t i = 0; i < in.size(); i++) {
    char c = in[i];
    if (c != '%') {
      out->push_back(c);
      continue;
    }
    if (i + 2 >= in.size() || !isxdigit((unsigned char)in[i + 1]) ||
        !isxdigit((unsigned char)in[i + 2]))
      return false;
    int v = std::stoi(in.substr(i + 1, 2), nullptr, 16);
    out->push_back((char)v);
    i += 2;
  }
  return true;
}

// path.posix.normalize: collapse slashes, resolve . and .. (clamped at root).
std::string posixNormalize(const std::string &p) {
  std::vector<std::string> parts;
  std::string cur;
  for (size_t i = 0; i <= p.size(); i++) {
    char c = i < p.size() ? p[i] : '/';
    if (c != '/') {
      cur.push_back(c);
      continue;
    }
    if (cur.empty() || cur == ".") {
    } else if (cur == "..") {
      if (!parts.empty()) parts.pop_back();
    } else {
      parts.push_back(cur);
    }
    cur.clear();
  }
  std::string r = "/";
  for (size_t i = 0; i < parts.size(); i++) {
    if (i) r += "/";
    r += parts[i];
  }
  return r;
}

std::string escHtml(const std::string &s) {
  std::string r;
  r.reserve(s.size());
  for (char c : s) {
    switch (c) {
      case '&': r += "&amp;"; break;
      case '<': r += "&lt;"; break;
      case '>': r += "&gt;"; break;
      case '"': r += "&quot;"; break;
      default: r.push_back(c);
    }
  }
  return r;
}

std::string contentTypeFor(const std::string &ext0) {
  std::string ext = toLowerAscii(ext0);
  if (ext == ".js") return "text/javascript; charset=utf-8";
  if (ext == ".css") return "text/css; charset=utf-8";
  if (ext == ".html") return "text/html; charset=utf-8";
  if (ext == ".json") return "application/json; charset=utf-8";
  if (ext == ".txt") return "text/plain; charset=utf-8";
  if (ext == ".svg") return "image/svg+xml";
  if (ext == ".png") return "image/png";
  if (ext == ".woff2") return "font/woff2";
  return "application/octet-stream";
}

// URL-safe base64 without padding (same alphabet as serve.js makeToken).
std::string base64UrlNoPad(const unsigned char *data, size_t len) {
  static const char *kB64 =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string r;
  for (size_t i = 0; i < len; i += 3) {
    unsigned n = (unsigned)data[i] << 16;
    if (i + 1 < len) n |= (unsigned)data[i + 1] << 8;
    if (i + 2 < len) n |= data[i + 2];
    r.push_back(kB64[(n >> 18) & 63]);
    r.push_back(kB64[(n >> 12) & 63]);
    if (i + 1 < len) r.push_back(kB64[(n >> 6) & 63]);
    if (i + 2 < len) r.push_back(kB64[n & 63]);
  }
  for (auto &c : r) {
    if (c == '+')
      c = '-';
    else if (c == '/')
      c = '_';
  }
  return r;
}

std::string sha256Hex(const std::string &s) {
  unsigned char h[crypto_hash_sha256_BYTES];
  crypto_hash_sha256(h, (const unsigned char *)s.data(), s.size());
  static const char *kHex = "0123456789abcdef";
  std::string r;
  r.resize(64);
  for (int i = 0; i < 32; i++) {
    r[2 * i] = kHex[h[i] >> 4];
    r[2 * i + 1] = kHex[h[i] & 15];
  }
  return r;
}

void sendJson(httplib::Response &res, int status, const json &obj) {
  res.status = status;
  res.set_content(obj.dump(), "application/json; charset=utf-8");
}

void sendText(httplib::Response &res, int status, const std::string &body) {
  res.status = status;
  res.set_content(body, "text/plain; charset=utf-8");
}

class Db {
 public:
  struct User {
    long id = 0;
    std::string role, username, name, passHash;
  };

  explicit Db(const std::string &path) {
    fs::path p(path);
    if (p.has_parent_path()) {
      std::error_code ec;
      fs::create_directories(p.parent_path(), ec);
    }
    if (sqlite3_open(path.c_str(), &db_) != SQLITE_OK) {
      std::string e = db_ ? sqlite3_errmsg(db_) : "out of memory";
      if (db_) sqlite3_close(db_);
      db_ = nullptr;
      throw std::runtime_error("cannot open db: " + e);
    }
    char *err = nullptr;
    sqlite3_exec(db_, "PRAGMA journal_mode=WAL;", nullptr, nullptr, &err);
    sqlite3_free(err);
    err = nullptr;
    if (sqlite3_exec(db_, kEducadSchema, nullptr, nullptr, &err) != SQLITE_OK) {
      std::string e = err ? err : "?";
      sqlite3_free(err);
      throw std::runtime_error("schema error: " + e);
    }
  }

  ~Db() {
    if (db_) sqlite3_close(db_);
  }
  Db(const Db &) = delete;
  Db &operator=(const Db &) = delete;

  bool findUser(const std::string &role, const std::string &username, User *out) {
    std::lock_guard<std::mutex> l(mu_);
    sqlite3_stmt *st = nullptr;
    if (sqlite3_prepare_v2(db_,
                           "SELECT id,role,username,name,pass_hash FROM users"
                           " WHERE role=?1 AND username=?2",
                           -1, &st, nullptr) != SQLITE_OK)
      return false;
    sqlite3_bind_text(st, 1, role.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 2, username.c_str(), -1, SQLITE_TRANSIENT);
    bool ok = false;
    if (sqlite3_step(st) == SQLITE_ROW) {
      out->id = (long)sqlite3_column_int64(st, 0);
      out->role = (const char *)sqlite3_column_text(st, 1);
      out->username = (const char *)sqlite3_column_text(st, 2);
      out->name = (const char *)sqlite3_column_text(st, 3);
      out->passHash = (const char *)sqlite3_column_text(st, 4);
      ok = true;
    }
    sqlite3_finalize(st);
    return ok;
  }

  // Returns the raw token (only shown once); only its hash is stored.
  std::string createSession(long userId) {
    unsigned char tok[32];
    randombytes_buf(tok, sizeof tok);
    std::string token = base64UrlNoPad(tok, sizeof tok);
    long now = std::time(nullptr);
    std::lock_guard<std::mutex> l(mu_);
    sqlite3_stmt *st = nullptr;
    if (sqlite3_prepare_v2(db_,
                           "INSERT INTO sessions(token_hash,user_id,created_at,expires_at)"
                           " VALUES(?1,?2,?3,?4)",
                           -1, &st, nullptr) != SQLITE_OK)
      return "";
    std::string h = sha256Hex(token);
    sqlite3_bind_text(st, 1, h.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(st, 2, userId);
    sqlite3_bind_int64(st, 3, now);
    sqlite3_bind_int64(st, 4, now + kSessionTtlSec);
    bool ok = sqlite3_step(st) == SQLITE_DONE;
    sqlite3_finalize(st);
    return ok ? token : "";
  }

  bool authSession(const std::string &token, User *out) {
    std::string h = sha256Hex(token);
    std::lock_guard<std::mutex> l(mu_);
    sqlite3_stmt *st = nullptr;
    if (sqlite3_prepare_v2(db_,
                           "SELECT u.id,u.role,u.username,u.name,s.expires_at"
                           " FROM sessions s JOIN users u ON u.id=s.user_id"
                           " WHERE s.token_hash=?1",
                           -1, &st, nullptr) != SQLITE_OK)
      return false;
    sqlite3_bind_text(st, 1, h.c_str(), -1, SQLITE_TRANSIENT);
    bool ok = false;
    long expires = 0;
    if (sqlite3_step(st) == SQLITE_ROW) {
      out->id = (long)sqlite3_column_int64(st, 0);
      out->role = (const char *)sqlite3_column_text(st, 1);
      out->username = (const char *)sqlite3_column_text(st, 2);
      out->name = (const char *)sqlite3_column_text(st, 3);
      expires = (long)sqlite3_column_int64(st, 4);
      ok = true;
    }
    sqlite3_finalize(st);
    if (!ok) return false;
    if (expires <= std::time(nullptr)) {
      deleteSessionLocked(h);
      return false;
    }
    return true;
  }

  void deleteSession(const std::string &token) {
    std::lock_guard<std::mutex> l(mu_);
    deleteSessionLocked(sha256Hex(token));
  }

  struct Drawing {
    long id = 0;
    long createdAt = 0, updatedAt = 0;
    std::string title, dataJson;
  };

  struct Progress {
    long updatedAt = 0;
    std::string lesson, stateJson;
  };

  long createDrawing(long userId, const std::string &title, const std::string &data) {
    std::lock_guard<std::mutex> l(mu_);
    sqlite3_stmt *st = nullptr;
    if (sqlite3_prepare_v2(db_,
                           "INSERT INTO drawings(user_id,title,data_json,created_at,updated_at)"
                           " VALUES(?1,?2,?3,?4,?4)",
                           -1, &st, nullptr) != SQLITE_OK)
      return -1;
    long now = std::time(nullptr);
    sqlite3_bind_int64(st, 1, userId);
    sqlite3_bind_text(st, 2, title.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 3, data.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(st, 4, now);
    bool ok = sqlite3_step(st) == SQLITE_DONE;
    long id = ok ? (long)sqlite3_last_insert_rowid(db_) : -1;
    sqlite3_finalize(st);
    return id;
  }

  std::vector<Drawing> listDrawings(long userId) {
    std::vector<Drawing> out;
    std::lock_guard<std::mutex> l(mu_);
    sqlite3_stmt *st = nullptr;
    if (sqlite3_prepare_v2(db_,
                           "SELECT id,title,created_at,updated_at FROM drawings"
                           " WHERE user_id=?1 ORDER BY updated_at DESC,id DESC",
                           -1, &st, nullptr) != SQLITE_OK)
      return out;
    sqlite3_bind_int64(st, 1, userId);
    while (sqlite3_step(st) == SQLITE_ROW) {
      Drawing d;
      d.id = (long)sqlite3_column_int64(st, 0);
      d.title = (const char *)sqlite3_column_text(st, 1);
      d.createdAt = (long)sqlite3_column_int64(st, 2);
      d.updatedAt = (long)sqlite3_column_int64(st, 3);
      out.push_back(d);
    }
    sqlite3_finalize(st);
    return out;
  }

  bool getDrawing(long userId, long id, Drawing *out) {
    std::lock_guard<std::mutex> l(mu_);
    sqlite3_stmt *st = nullptr;
    if (sqlite3_prepare_v2(db_,
                           "SELECT id,title,data_json,created_at,updated_at FROM drawings"
                           " WHERE id=?1 AND user_id=?2",
                           -1, &st, nullptr) != SQLITE_OK)
      return false;
    sqlite3_bind_int64(st, 1, id);
    sqlite3_bind_int64(st, 2, userId);
    bool ok = false;
    if (sqlite3_step(st) == SQLITE_ROW) {
      out->id = (long)sqlite3_column_int64(st, 0);
      out->title = (const char *)sqlite3_column_text(st, 1);
      out->dataJson = (const char *)sqlite3_column_text(st, 2);
      out->createdAt = (long)sqlite3_column_int64(st, 3);
      out->updatedAt = (long)sqlite3_column_int64(st, 4);
      ok = true;
    }
    sqlite3_finalize(st);
    return ok;
  }

  // Null title/data means "leave unchanged". False when the row is missing
  // (or not owned); updatedAt receives the new timestamp on success.
  bool updateDrawing(long userId, long id, const std::string *title,
                     const std::string *data, long *updatedAt) {
    if (!title && !data) return false;
    std::string sql = "UPDATE drawings SET updated_at=?1";
    int next = 2, titleIdx = 0, dataIdx = 0;
    if (title) {
      sql += ",title=?" + std::to_string(next);
      titleIdx = next++;
    }
    if (data) {
      sql += ",data_json=?" + std::to_string(next);
      dataIdx = next++;
    }
    int idIdx = next++, userIdx = next++;
    sql += " WHERE id=?" + std::to_string(idIdx) + " AND user_id=?" + std::to_string(userIdx);
    std::lock_guard<std::mutex> l(mu_);
    sqlite3_stmt *st = nullptr;
    if (sqlite3_prepare_v2(db_, sql.c_str(), -1, &st, nullptr) != SQLITE_OK) return false;
    long now = std::time(nullptr);
    sqlite3_bind_int64(st, 1, now);
    if (title) sqlite3_bind_text(st, titleIdx, title->c_str(), -1, SQLITE_TRANSIENT);
    if (data) sqlite3_bind_text(st, dataIdx, data->c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(st, idIdx, id);
    sqlite3_bind_int64(st, userIdx, userId);
    bool ok = sqlite3_step(st) == SQLITE_DONE && sqlite3_changes(db_) > 0;
    sqlite3_finalize(st);
    if (ok && updatedAt) *updatedAt = now;
    return ok;
  }

  bool deleteDrawing(long userId, long id) {
    std::lock_guard<std::mutex> l(mu_);
    sqlite3_stmt *st = nullptr;
    if (sqlite3_prepare_v2(db_, "DELETE FROM drawings WHERE id=?1 AND user_id=?2",
                           -1, &st, nullptr) != SQLITE_OK)
      return false;
    sqlite3_bind_int64(st, 1, id);
    sqlite3_bind_int64(st, 2, userId);
    bool ok = sqlite3_step(st) == SQLITE_DONE && sqlite3_changes(db_) > 0;
    sqlite3_finalize(st);
    return ok;
  }

  std::vector<Progress> listProgress(long userId) {
    std::vector<Progress> out;
    std::lock_guard<std::mutex> l(mu_);
    sqlite3_stmt *st = nullptr;
    if (sqlite3_prepare_v2(db_,
                           "SELECT lesson,state_json,updated_at FROM progress"
                           " WHERE user_id=?1 ORDER BY lesson",
                           -1, &st, nullptr) != SQLITE_OK)
      return out;
    sqlite3_bind_int64(st, 1, userId);
    while (sqlite3_step(st) == SQLITE_ROW) {
      Progress p;
      p.lesson = (const char *)sqlite3_column_text(st, 0);
      p.stateJson = (const char *)sqlite3_column_text(st, 1);
      p.updatedAt = (long)sqlite3_column_int64(st, 2);
      out.push_back(p);
    }
    sqlite3_finalize(st);
    return out;
  }

  bool putProgress(long userId, const std::string &lesson, const std::string &state) {
    std::lock_guard<std::mutex> l(mu_);
    sqlite3_stmt *st = nullptr;
    if (sqlite3_prepare_v2(db_,
                           "INSERT INTO progress(user_id,lesson,state_json,updated_at)"
                           " VALUES(?1,?2,?3,?4)"
                           " ON CONFLICT(user_id,lesson) DO UPDATE SET"
                           " state_json=excluded.state_json,updated_at=excluded.updated_at",
                           -1, &st, nullptr) != SQLITE_OK)
      return false;
    sqlite3_bind_int64(st, 1, userId);
    sqlite3_bind_text(st, 2, lesson.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 3, state.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(st, 4, (long)std::time(nullptr));
    bool ok = sqlite3_step(st) == SQLITE_DONE;
    sqlite3_finalize(st);
    return ok;
  }

 private:
  void deleteSessionLocked(const std::string &hash) {
    sqlite3_stmt *st = nullptr;
    if (sqlite3_prepare_v2(db_, "DELETE FROM sessions WHERE token_hash=?1", -1,
                           &st, nullptr) != SQLITE_OK)
      return;
    sqlite3_bind_text(st, 1, hash.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_step(st);
    sqlite3_finalize(st);
  }

  sqlite3 *db_ = nullptr;
  std::mutex mu_;
};

bool bearerToken(const httplib::Request &req, std::string *out) {
  std::string h = req.get_header_value("Authorization");
  const std::string pre = "Bearer ";
  if (h.size() <= pre.size() || h.compare(0, pre.size(), pre) != 0) return false;
  *out = trimWs(h.substr(pre.size()));
  return !out->empty();
}

// 401 + false when the request carries no valid session token.
bool requireAuth(Db &db, const httplib::Request &req, httplib::Response &res,
                 Db::User *out) {
  std::string token;
  if (!bearerToken(req, &token) || !db.authSession(token, out)) {
    sendJson(res, 401, {{"ok", false}, {"error", "unauthorized"}});
    return false;
  }
  return true;
}

// Parse a JSON object body with a size cap; on failure sends 413/400.
bool jsonBody(const httplib::Request &req, httplib::Response &res, size_t maxBody,
              json *out) {
  if (req.body.size() > maxBody) {
    sendJson(res, 413, {{"ok", false}, {"error", "request too large"}});
    return false;
  }
  try {
    *out = json::parse(req.body.empty() ? "{}" : req.body);
  } catch (...) {
    sendJson(res, 400, {{"ok", false}, {"error", "invalid json"}});
    return false;
  }
  if (!out->is_object()) {
    sendJson(res, 400, {{"ok", false}, {"error", "invalid json"}});
    return false;
  }
  return true;
}

bool parseDrawingId(const std::string &path, long *out) {
  static const std::string pre = "/api/drawings/";
  if (path.size() <= pre.size() || path.compare(0, pre.size(), pre) != 0) return false;
  std::string id = path.substr(pre.size());
  if (id.empty() || id.size() > 18) return false;
  for (char c : id)
    if (!isdigit((unsigned char)c)) return false;
  *out = std::stol(id);
  return *out > 0;
}

bool validLesson(const std::string &lesson) {
  if (lesson.empty() || lesson.size() > 128) return false;
  for (char c : lesson) {
    if (!isalnum((unsigned char)c) && c != '_' && c != '-' && c != '.') return false;
  }
  return true;
}

json parseStored(const std::string &s) {
  try {
    return json::parse(s);
  } catch (...) {
    return json(nullptr);
  }
}

// Static file serving, mirroring serve.js resolvePath + listDir.
void handleStatic(const fs::path &root, const httplib::Request &req,
                  httplib::Response &res) {
  if (req.path.rfind("/api/", 0) == 0) {  // guarded by pre-routing; be safe
    sendJson(res, 404, {{"ok", false}, {"error", "not found"}});
    return;
  }
  std::string target = req.target;
  std::string p = target.substr(0, target.find_first_of("?#"));
  std::string dec;
  if (!pctDecode(p, &dec) || dec.find('\0') != std::string::npos) {
    sendText(res, 400, "bad request");
    return;
  }
  if (dec == "/geometry" || dec == "/geometry/") dec = "/index.html";
  std::string norm = posixNormalize("/" + dec);
  std::string rel = norm.size() > 1 ? norm.substr(1) : "";
  fs::path abs = (root / rel).lexically_normal();
  // Lexical containment (norm cannot escape by construction; keep the check).
  {
    std::string rs = root.lexically_normal().string();
    std::string as = abs.string();
    if (as != rs && (as.size() <= rs.size() || as.compare(0, rs.size(), rs) != 0 ||
                     as[rs.size()] != '/')) {
      sendText(res, 400, "bad request");
      return;
    }
  }
  std::error_code ec;
  if (!fs::exists(abs, ec) || ec) {
    sendText(res, 404, "not found");
    return;
  }
  bool isHead = req.method == "HEAD";
  if (fs::is_directory(abs, ec) && !ec) {
    fs::path idx = abs / "index.html";
    if (fs::is_regular_file(idx, ec) && !ec) {
      abs = idx;
    } else {
      // Directory listing (serve.js listDir).
      std::vector<std::string> entries;
      for (const auto &e : fs::directory_iterator(abs, ec)) {
        if (ec) break;
        entries.push_back(e.path().filename().string());
      }
      if (ec) {
        sendText(res, 404, "not found");
        return;
      }
      std::sort(entries.begin(), entries.end());
      std::string base = "/" + rel;
      while (base.size() > 1 && base.back() == '/') base.pop_back();
      if (base == "/") base = "";
      std::string html =
          "<!doctype html><html><head><meta charset=\"utf-8\">"
          "<title>EduCAD mirror</title></head><body><h1>EduCAD mirror</h1><ul>";
      auto collapseSlashes = [](std::string s) {
        std::string r;
        for (char c : s) {
          if (c == '/' && !r.empty() && r.back() == '/') continue;
          r.push_back(c);
        }
        return r;
      };
      if (!rel.empty()) html += "<li><a href=\"" + escHtml(base + "/..") + "\">..</a></li>";
      for (const auto &name : entries) {
        std::string href = collapseSlashes(base + "/" + name);
        html += "<li><a href=\"" + escHtml(href) + "\">" + escHtml(name) + "</a></li>";
      }
      html += "</ul></body></html>";
      res.status = 200;
      if (isHead) {
        res.set_header("Content-Type", "text/html; charset=utf-8");
        res.set_header("Content-Length", std::to_string(html.size()));
      } else {
        res.set_content(html, "text/html; charset=utf-8");
      }
      return;
    }
  }
  if (!fs::is_regular_file(abs, ec) || ec) {
    sendText(res, 404, "not found");
    return;
  }
  std::ifstream f(abs, std::ios::binary);
  if (!f) {
    sendText(res, 404, "not found");
    return;
  }
  std::string body((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
  std::string ct = contentTypeFor(abs.extension().string());
  res.status = 200;
  if (isHead) {
    res.set_header("Content-Type", ct);
    res.set_header("Content-Length", std::to_string(body.size()));
  } else {
    res.set_content(body, ct);
  }
}

void handleLogin(Db &db, const httplib::Request &req, httplib::Response &res) {
  if (req.body.size() > kLoginMaxBody) {
    sendJson(res, 413, {{"ok", false}, {"error", "request too large"}});
    return;
  }
  json body;
  try {
    body = json::parse(req.body.empty() ? "{}" : req.body);
  } catch (...) {
    sendJson(res, 400, {{"ok", false}, {"error", "invalid json"}});
    return;
  }
  if (!body.is_object()) {
    sendJson(res, 400, {{"ok", false}, {"error", "invalid json"}});
    return;
  }
  std::string role;
  if (body.contains("role") && body["role"].is_string())
    role = toLowerAscii(body["role"].get<std::string>());
  if (std::find(kRoles.begin(), kRoles.end(), role) == kRoles.end()) {
    sendJson(res, 400, {{"ok", false}, {"error", "unknown role"}});
    return;
  }
  std::string u = (body.contains("username") && body["username"].is_string())
                      ? trimWs(body["username"].get<std::string>())
                      : "";
  std::string pw = (body.contains("password") && body["password"].is_string())
                       ? body["password"].get<std::string>()
                       : "";
  if (u.empty() || pw.empty()) {
    sendJson(res, 401, {{"ok", false}, {"error", "Invalid username or password"}});
    return;
  }
  Db::User user;
  if (!db.findUser(role, u, &user) ||
      crypto_pwhash_str_verify(user.passHash.c_str(), pw.c_str(), pw.size()) != 0) {
    sendJson(res, 401, {{"ok", false}, {"error", "Invalid username or password"}});
    return;
  }
  std::string token = db.createSession(user.id);
  if (token.empty()) {
    sendJson(res, 500, {{"ok", false}, {"error", "cannot create session"}});
    return;
  }
  sendJson(res, 200, {{"ok", true},
                      {"role", user.role},
                      {"username", user.username},
                      {"name", user.name},
                      {"token", token}});
}

void setupRoutes(httplib::Server &svr, Db &db, const fs::path &root) {
  using HR = httplib::Server::HandlerResponse;
  // httplib defaults to SO_REUSEPORT, which lets a second server share a busy
  // port instead of failing. Use plain SO_REUSEADDR so EADDRINUSE surfaces and
  // the serve.js-style busy-port retry in main() works.
  svr.set_socket_options([](auto sock) {
#ifndef _WIN32
    int one = 1;
    ::setsockopt(sock, SOL_SOCKET, SO_REUSEADDR, &one, sizeof(one));
#else
    (void)sock;
#endif
  });
  svr.set_pre_routing_handler([&](const httplib::Request &req, httplib::Response &res) {
    const std::string &m = req.method;
    const std::string &path = req.path;
    if (path.rfind("/api/", 0) == 0) {
      bool known = false, allowed = false;
      if (path == "/api/login" || path == "/api/logout") {
        known = true;
        allowed = (m == "POST");
      } else if (path == "/api/me") {
        known = true;
        allowed = (m == "GET");
      } else if (path == "/api/drawings") {
        known = true;
        allowed = (m == "GET" || m == "POST");
      } else if (path == "/api/progress") {
        known = true;
        allowed = (m == "GET");
      } else if (path.rfind("/api/drawings/", 0) == 0 && path.size() > 14) {
        known = true;
        allowed = (m == "GET" || m == "PUT" || m == "DELETE");
      } else if (path.rfind("/api/progress/", 0) == 0 && path.size() > 14) {
        known = true;
        allowed = (m == "PUT");
      }
      if (!known) {
        sendJson(res, 404, {{"ok", false}, {"error", "not found"}});
        return HR::Handled;
      }
      if (!allowed) {
        sendJson(res, 405, {{"ok", false}, {"error", "method not allowed"}});
        return HR::Handled;
      }
      return HR::Unhandled;
    }
    if (m != "GET" && m != "HEAD") {
      sendText(res, 405, "method not allowed");
      return HR::Handled;
    }
    return HR::Unhandled;
  });
  // NOTE: httplib invokes this for EVERY response with status >= 400, so it
  // must only fill in true routing misses (empty body) and leave intentional
  // error statuses (401/405/...) from handlers untouched.
  svr.set_error_handler([](const httplib::Request &req, httplib::Response &res) {
    if (!res.body.empty()) return httplib::Server::HandlerResponse::Unhandled;
    if (req.path.rfind("/api/", 0) == 0)
      sendJson(res, 404, {{"ok", false}, {"error", "not found"}});
    else
      sendText(res, 404, "not found");
    return httplib::Server::HandlerResponse::Handled;
  });

  svr.Post("/api/login", [&](const httplib::Request &req, httplib::Response &res) {
    handleLogin(db, req, res);
  });
  svr.Post("/api/logout", [&](const httplib::Request &req, httplib::Response &res) {
    std::string token;
    if (bearerToken(req, &token)) db.deleteSession(token);
    sendJson(res, 200, {{"ok", true}});
  });
  svr.Get("/api/me", [&](const httplib::Request &req, httplib::Response &res) {
    std::string token;
    Db::User user;
    if (!bearerToken(req, &token) || !db.authSession(token, &user)) {
      sendJson(res, 401, {{"ok", false}, {"error", "unauthorized"}});
      return;
    }
    sendJson(res, 200, {{"ok", true},
                        {"role", user.role},
                        {"username", user.username},
                        {"name", user.name}});
  });

  svr.Get("/api/drawings", [&](const httplib::Request &req, httplib::Response &res) {
    Db::User user;
    if (!requireAuth(db, req, res, &user)) return;
    json arr = json::array();
    for (const Db::Drawing &d : db.listDrawings(user.id)) {
      arr.push_back({{"id", d.id},
                     {"title", d.title},
                     {"created_at", d.createdAt},
                     {"updated_at", d.updatedAt}});
    }
    sendJson(res, 200, {{"ok", true}, {"drawings", arr}});
  });
  svr.Post("/api/drawings", [&](const httplib::Request &req, httplib::Response &res) {
    Db::User user;
    if (!requireAuth(db, req, res, &user)) return;
    json body;
    if (!jsonBody(req, res, kSaveMaxBody, &body)) return;
    if (!body.contains("data")) {
      sendJson(res, 400, {{"ok", false}, {"error", "missing data"}});
      return;
    }
    std::string title = "Untitled";
    if (body.contains("title")) {
      if (!body["title"].is_string()) {
        sendJson(res, 400, {{"ok", false}, {"error", "invalid title"}});
        return;
      }
      title = trimWs(body["title"].get<std::string>());
      if (title.empty()) title = "Untitled";
      if (title.size() > 200) title.resize(200);
    }
    long id = db.createDrawing(user.id, title, body["data"].dump());
    if (id < 0) {
      sendJson(res, 500, {{"ok", false}, {"error", "cannot save drawing"}});
      return;
    }
    sendJson(res, 201, {{"ok", true}, {"id", id}});
  });
  svr.Get(R"(/api/drawings/(\d+))", [&](const httplib::Request &req, httplib::Response &res) {
    Db::User user;
    if (!requireAuth(db, req, res, &user)) return;
    long id = 0;
    Db::Drawing d;
    if (!parseDrawingId(req.path, &id) || !db.getDrawing(user.id, id, &d)) {
      sendJson(res, 404, {{"ok", false}, {"error", "not found"}});
      return;
    }
    sendJson(res, 200, {{"ok", true},
                        {"id", d.id},
                        {"title", d.title},
                        {"data", parseStored(d.dataJson)},
                        {"created_at", d.createdAt},
                        {"updated_at", d.updatedAt}});
  });
  svr.Put(R"(/api/drawings/(\d+))", [&](const httplib::Request &req, httplib::Response &res) {
    Db::User user;
    if (!requireAuth(db, req, res, &user)) return;
    long id = 0;
    if (!parseDrawingId(req.path, &id)) {
      sendJson(res, 404, {{"ok", false}, {"error", "not found"}});
      return;
    }
    json body;
    if (!jsonBody(req, res, kSaveMaxBody, &body)) return;
    bool hasTitle = body.contains("title"), hasData = body.contains("data");
    if (!hasTitle && !hasData) {
      sendJson(res, 400, {{"ok", false}, {"error", "nothing to update"}});
      return;
    }
    std::string title, data, *pt = nullptr, *pd = nullptr;
    if (hasTitle) {
      if (!body["title"].is_string()) {
        sendJson(res, 400, {{"ok", false}, {"error", "invalid title"}});
        return;
      }
      title = trimWs(body["title"].get<std::string>());
      if (title.empty()) title = "Untitled";
      if (title.size() > 200) title.resize(200);
      pt = &title;
    }
    if (hasData) {
      data = body["data"].dump();
      pd = &data;
    }
    long updated = 0;
    if (!db.updateDrawing(user.id, id, pt, pd, &updated)) {
      sendJson(res, 404, {{"ok", false}, {"error", "not found"}});
      return;
    }
    sendJson(res, 200, {{"ok", true}, {"id", id}, {"updated_at", updated}});
  });
  svr.Delete(R"(/api/drawings/(\d+))", [&](const httplib::Request &req, httplib::Response &res) {
    Db::User user;
    if (!requireAuth(db, req, res, &user)) return;
    long id = 0;
    if (!parseDrawingId(req.path, &id) || !db.deleteDrawing(user.id, id)) {
      sendJson(res, 404, {{"ok", false}, {"error", "not found"}});
      return;
    }
    sendJson(res, 200, {{"ok", true}});
  });
  svr.Get("/api/progress", [&](const httplib::Request &req, httplib::Response &res) {
    Db::User user;
    if (!requireAuth(db, req, res, &user)) return;
    json arr = json::array();
    for (const Db::Progress &p : db.listProgress(user.id)) {
      arr.push_back({{"lesson", p.lesson},
                     {"state", parseStored(p.stateJson)},
                     {"updated_at", p.updatedAt}});
    }
    sendJson(res, 200, {{"ok", true}, {"progress", arr}});
  });
  svr.Put(R"(/api/progress/([^/]+))", [&](const httplib::Request &req, httplib::Response &res) {
    Db::User user;
    if (!requireAuth(db, req, res, &user)) return;
    std::string lesson = req.path.substr(std::string("/api/progress/").size());
    if (!validLesson(lesson)) {
      sendJson(res, 400, {{"ok", false}, {"error", "bad lesson"}});
      return;
    }
    json body;
    if (!jsonBody(req, res, kSaveMaxBody, &body)) return;
    if (!body.contains("state")) {
      sendJson(res, 400, {{"ok", false}, {"error", "missing state"}});
      return;
    }
    if (!db.putProgress(user.id, lesson, body["state"].dump())) {
      sendJson(res, 500, {{"ok", false}, {"error", "cannot save progress"}});
      return;
    }
    sendJson(res, 200, {{"ok", true}, {"lesson", lesson}});
  });

  // Static catch-all (registered after API routes; exact API matches win).
  // HEAD dispatches here too (httplib routes HEAD to GET handlers).
  svr.Get(".*", [&](const httplib::Request &req, httplib::Response &res) {
    handleStatic(root, req, res);
  });
}

int parsePort(const char *v) {
  if (!v || !*v) return -1;
  char *end = nullptr;
  long n = std::strtol(v, &end, 10);
  if (!end || *end || n < 1 || n > 65535) return -1;
  return (int)n;
}

fs::path exeDir(char *argv0) {
#ifdef __linux__
  char buf[4096];
  ssize_t n = readlink("/proc/self/exe", buf, sizeof(buf) - 1);
  if (n > 0) {
    buf[n] = 0;
    return fs::path(buf).parent_path();
  }
#endif
  return fs::absolute(fs::path(argv0)).parent_path();
}

}  // namespace

int main(int argc, char **argv) {
  if (sodium_init() < 0) {
    std::cerr << "educad serve error: libsodium init failed\n";
    return 1;
  }
  int port = kDefaultPort;
  if (argc > 1) {
    int p = parsePort(argv[1]);
    if (p > 0) port = p;
  } else if (const char *e = std::getenv("PORT")) {
    int p = parsePort(e);
    if (p > 0) port = p;
  }
  fs::path exe = exeDir(argv[0]);
  fs::path root = (std::getenv("EDUCAD_ROOT") ? fs::path(std::getenv("EDUCAD_ROOT"))
                                             : (exe / ".." / ".." / "mirror"))
                      .lexically_normal();
  std::string dbPath = std::getenv("EDUCAD_DB")
                           ? std::getenv("EDUCAD_DB")
                           : (exe / ".." / "data" / "educad.db").lexically_normal().string();
  Db *db = nullptr;
  try {
    db = new Db(dbPath);
  } catch (const std::exception &e) {
    std::cerr << "educad serve error: " << e.what() << "\n";
    return 1;
  }
  // Fresh server per attempt so a failed bind leaves no residue.
  for (int i = 0; i < kMaxBindAttempts && port + i <= 65535; i++) {
    httplib::Server *svr = new httplib::Server();
    setupRoutes(*svr, *db, root);
    if (svr->bind_to_port(kHost, port + i)) {
      int actual = port + i;
      if (actual != port)
        std::cerr << "educad serve: port " << port << " busy, using " << actual << "\n";
      std::cout << "educad serve http://" << kHost << ":" << actual << "/ -> "
                << root.string() << std::endl;
      svr->listen_after_bind();
      return 0;
    }
    delete svr;
  }
  std::cerr << "educad serve error: cannot bind to any port\n";
  return 1;
}
