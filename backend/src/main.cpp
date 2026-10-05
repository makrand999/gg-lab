// EduCAD C++ backend: static file server for public/ + JSON API.
// Serves public/ plus the JSON API (login, drawings, progress, sets, classes).
//
//   educad-server [port]   (default 8124; $PORT fallback; +10 busy retry)
//   env: EDUCAD_ROOT (default <exe>/../../public)
//        EDUCAD_DB   (default <exe>/../data/educad.db, outside served root)
//
// Static files + auth (POST /api/login, POST /api/logout, GET /api/me)
// + saves (GET/POST /api/drawings, GET/PUT/DELETE /api/drawings/:id,
// GET /api/progress, PUT /api/progress/:lesson)
// + question sets (GET/POST /api/sets, GET/DELETE /api/sets/:code,
// GET/POST /api/sets/:code/submissions, POST /api/sets/:code/verify,
// PUT/DELETE /api/sets/:code/questions/:qi/model,
// PUT /api/sets/:code/questions/:qi/check, GET /api/submissions/mine,
// GET /api/submissions/:id, PUT /api/submissions/:id/grade)
// + classes (GET/POST /api/classes, GET/DELETE /api/classes/:code,
// POST /api/classes/:code/join, POST /api/classes/:code/leave,
// GET /api/classes/:code/members, GET /api/classes/:code/sets)
// + natural language (POST /api/interpret: words to slash commands).
// Sets carry an optional class_id (NULL = open set, solvable by code).

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <map>
#include <mutex>
#include <stdexcept>
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

// Percent-decode; false on invalid encoding (caller answers 400).
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

// URL-safe base64 without padding, for opaque session tokens.
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
    // Migration for databases created before classes existed: the new
    // tables come from the schema above, but the class_id column must be
    // added to the existing sets table. Re-running on a migrated db
    // fails with "duplicate column" — that error is ignored on purpose.
    err = nullptr;
    sqlite3_exec(db_, "ALTER TABLE sets ADD COLUMN class_id INTEGER;",
                 nullptr, nullptr, &err);
    sqlite3_free(err);
    // Migration for grading + auto-check: new columns on submissions.
    // Duplicate-column errors are ignored on purpose (idempotent).
    const char *kSubMig[] = {
        "ALTER TABLE submissions ADD COLUMN verdict TEXT NOT NULL DEFAULT '';",
        "ALTER TABLE submissions ADD COLUMN remarks TEXT NOT NULL DEFAULT '';",
        "ALTER TABLE submissions ADD COLUMN auto_pass INTEGER;",
        "ALTER TABLE submissions ADD COLUMN auto_score REAL;",
    };
    for (int i = 0; i < 4; i++) {
      err = nullptr;
      sqlite3_exec(db_, kSubMig[i], nullptr, nullptr, &err);
      sqlite3_free(err);
    }
    err = nullptr;
    sqlite3_exec(db_,
                 "ALTER TABLE submissions ADD COLUMN auto_details TEXT"
                 " NOT NULL DEFAULT '';",
                 nullptr, nullptr, &err);
    sqlite3_free(err);
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

  struct Set {
    long id = 0, ownerId = 0, createdAt = 0, classId = 0;
    int nquestions = 0;
    std::string code, title, questionsJson, ownerName, classCode, classTitle;
  };

  struct Class {
    long id = 0, ownerId = 0, createdAt = 0, nmembers = 0, nsets = 0;
    std::string code, title, ownerName;
  };

  struct Member {
    long userId = 0, joinedAt = 0;
    std::string username, name;
  };

  struct Submission {
    long id = 0, setId = 0, userId = 0, createdAt = 0;
    int questionIndex = 0;
    // autoPass: -1 = not checked (no model / check off), 0 = fail, 1 = pass.
    int autoPass = -1;
    double autoScore = 0;
    bool hasAutoScore = false;
    std::string setCode, username, name, note, dataJson;
    std::string verdict, remarks, autoDetails;
  };

  // Fill a Set row from the shared SELECT shape below (columns 0-9).
  static void readSetRow(sqlite3_stmt *st, Set *s) {
    s->id = (long)sqlite3_column_int64(st, 0);
    s->code = (const char *)sqlite3_column_text(st, 1);
    s->title = (const char *)sqlite3_column_text(st, 2);
    s->questionsJson = (const char *)sqlite3_column_text(st, 3);
    s->ownerId = (long)sqlite3_column_int64(st, 4);
    s->createdAt = (long)sqlite3_column_int64(st, 5);
    s->ownerName = (const char *)sqlite3_column_text(st, 6);
    s->classId = sqlite3_column_type(st, 7) == SQLITE_NULL
                     ? 0
                     : (long)sqlite3_column_int64(st, 7);
    const unsigned char *cc = sqlite3_column_text(st, 8);
    const unsigned char *ct = sqlite3_column_text(st, 9);
    s->classCode = cc ? (const char *)cc : "";
    s->classTitle = ct ? (const char *)ct : "";
  }

  static const char *kSetCols() {
    return "SELECT s.id,s.code,s.title,s.questions_json,s.owner_id,"
           "s.created_at,u.name,s.class_id,c.code,c.title FROM sets s"
           " JOIN users u ON u.id=s.owner_id"
           " LEFT JOIN classes c ON c.id=s.class_id";
  }

  // Returns new id, -2 when the code is taken, -1 on other errors.
  // classId <= 0 stores NULL (open set, solvable by code).
  long createSet(long ownerId, const std::string &code, const std::string &title,
                 const std::string &questions, long classId) {
    std::lock_guard<std::mutex> l(mu_);
    sqlite3_stmt *st = nullptr;
    if (sqlite3_prepare_v2(db_,
                           "INSERT INTO sets(code,title,questions_json,owner_id,class_id,"
                           "created_at) VALUES(?1,?2,?3,?4,?5,?6)",
                           -1, &st, nullptr) != SQLITE_OK)
      return -1;
    sqlite3_bind_text(st, 1, code.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 2, title.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 3, questions.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(st, 4, ownerId);
    if (classId > 0)
      sqlite3_bind_int64(st, 5, classId);
    else
      sqlite3_bind_null(st, 5);
    sqlite3_bind_int64(st, 6, (long)std::time(nullptr));
    int rc = sqlite3_step(st);
    long id = -1;
    if (rc == SQLITE_DONE)
      id = (long)sqlite3_last_insert_rowid(db_);
    else if (rc == SQLITE_CONSTRAINT_UNIQUE || rc == SQLITE_CONSTRAINT)
      id = -2;
    sqlite3_finalize(st);
    return id;
  }

  // ownerId < 0 lists every set (academics); otherwise only the owner's.
  std::vector<Set> listSets(long ownerId) {
    std::vector<Set> out;
    std::lock_guard<std::mutex> l(mu_);
    std::string sql = kSetCols();
    if (ownerId >= 0) sql += " WHERE s.owner_id=?1";
    sql += " ORDER BY s.created_at DESC,s.id DESC";
    sqlite3_stmt *st = nullptr;
    if (sqlite3_prepare_v2(db_, sql.c_str(), -1, &st, nullptr) != SQLITE_OK) return out;
    if (ownerId >= 0) sqlite3_bind_int64(st, 1, ownerId);
    while (sqlite3_step(st) == SQLITE_ROW) {
      Set s;
      readSetRow(st, &s);
      out.push_back(s);
    }
    sqlite3_finalize(st);
    return out;
  }

  // Student feed: open sets plus sets posted to joined classes.
  std::vector<Set> listSetsForStudent(long userId) {
    std::vector<Set> out;
    std::lock_guard<std::mutex> l(mu_);
    std::string sql = kSetCols();
    sql += " WHERE s.class_id IS NULL OR s.class_id IN"
           " (SELECT class_id FROM class_members WHERE user_id=?1)"
           " ORDER BY s.created_at DESC,s.id DESC";
    sqlite3_stmt *st = nullptr;
    if (sqlite3_prepare_v2(db_, sql.c_str(), -1, &st, nullptr) != SQLITE_OK) return out;
    sqlite3_bind_int64(st, 1, userId);
    while (sqlite3_step(st) == SQLITE_ROW) {
      Set s;
      readSetRow(st, &s);
      out.push_back(s);
    }
    sqlite3_finalize(st);
    return out;
  }

  std::vector<Set> listClassSets(long classId) {
    std::vector<Set> out;
    std::lock_guard<std::mutex> l(mu_);
    std::string sql = kSetCols();
    sql += " WHERE s.class_id=?1 ORDER BY s.created_at DESC,s.id DESC";
    sqlite3_stmt *st = nullptr;
    if (sqlite3_prepare_v2(db_, sql.c_str(), -1, &st, nullptr) != SQLITE_OK) return out;
    sqlite3_bind_int64(st, 1, classId);
    while (sqlite3_step(st) == SQLITE_ROW) {
      Set s;
      readSetRow(st, &s);
      out.push_back(s);
    }
    sqlite3_finalize(st);
    return out;
  }

  bool getSetByCode(const std::string &code, Set *out) {
    std::lock_guard<std::mutex> l(mu_);
    std::string sql = kSetCols();
    sql += " WHERE s.code=?1";
    sqlite3_stmt *st = nullptr;
    if (sqlite3_prepare_v2(db_, sql.c_str(), -1, &st, nullptr) != SQLITE_OK)
      return false;
    sqlite3_bind_text(st, 1, code.c_str(), -1, SQLITE_TRANSIENT);
    bool ok = false;
    if (sqlite3_step(st) == SQLITE_ROW) {
      readSetRow(st, out);
      ok = true;
    }
    sqlite3_finalize(st);
    return ok;
  }

  // Returns new id, -2 when the code is taken, -1 on other errors.
  long createClass(long ownerId, const std::string &code, const std::string &title) {
    std::lock_guard<std::mutex> l(mu_);
    sqlite3_stmt *st = nullptr;
    if (sqlite3_prepare_v2(db_,
                           "INSERT INTO classes(code,title,owner_id,created_at)"
                           " VALUES(?1,?2,?3,?4)",
                           -1, &st, nullptr) != SQLITE_OK)
      return -1;
    sqlite3_bind_text(st, 1, code.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 2, title.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(st, 3, ownerId);
    sqlite3_bind_int64(st, 4, (long)std::time(nullptr));
    int rc = sqlite3_step(st);
    long id = -1;
    if (rc == SQLITE_DONE)
      id = (long)sqlite3_last_insert_rowid(db_);
    else if (rc == SQLITE_CONSTRAINT_UNIQUE || rc == SQLITE_CONSTRAINT)
      id = -2;
    sqlite3_finalize(st);
    return id;
  }

  static void readClassRow(sqlite3_stmt *st, Class *c) {
    c->id = (long)sqlite3_column_int64(st, 0);
    c->code = (const char *)sqlite3_column_text(st, 1);
    c->title = (const char *)sqlite3_column_text(st, 2);
    c->ownerId = (long)sqlite3_column_int64(st, 3);
    c->createdAt = (long)sqlite3_column_int64(st, 4);
    c->ownerName = (const char *)sqlite3_column_text(st, 5);
    c->nmembers = (long)sqlite3_column_int64(st, 6);
    c->nsets = (long)sqlite3_column_int64(st, 7);
  }

  static const char *kClassCols() {
    return "SELECT c.id,c.code,c.title,c.owner_id,c.created_at,u.name,"
           "(SELECT COUNT(*) FROM class_members m WHERE m.class_id=c.id),"
           "(SELECT COUNT(*) FROM sets s WHERE s.class_id=c.id)"
           " FROM classes c JOIN users u ON u.id=c.owner_id";
  }

  bool getClassByCode(const std::string &code, Class *out) {
    std::lock_guard<std::mutex> l(mu_);
    std::string sql = kClassCols();
    sql += " WHERE c.code=?1";
    sqlite3_stmt *st = nullptr;
    if (sqlite3_prepare_v2(db_, sql.c_str(), -1, &st, nullptr) != SQLITE_OK)
      return false;
    sqlite3_bind_text(st, 1, code.c_str(), -1, SQLITE_TRANSIENT);
    bool ok = false;
    if (sqlite3_step(st) == SQLITE_ROW) {
      readClassRow(st, out);
      ok = true;
    }
    sqlite3_finalize(st);
    return ok;
  }

  // Academics (scope "all") see every class; teachers ("own") their own;
  // students ("joined") the classes they joined.
  std::vector<Class> listClasses(const std::string &scope, long userId) {
    std::vector<Class> out;
    std::lock_guard<std::mutex> l(mu_);
    std::string sql = kClassCols();
    if (scope == "own")
      sql += " WHERE c.owner_id=?1";
    else if (scope == "joined")
      sql += " WHERE c.id IN (SELECT class_id FROM class_members WHERE user_id=?1)";
    sql += " ORDER BY c.created_at DESC,c.id DESC";
    sqlite3_stmt *st = nullptr;
    if (sqlite3_prepare_v2(db_, sql.c_str(), -1, &st, nullptr) != SQLITE_OK) return out;
    if (scope != "all") sqlite3_bind_int64(st, 1, userId);
    while (sqlite3_step(st) == SQLITE_ROW) {
      Class c;
      readClassRow(st, &c);
      out.push_back(c);
    }
    sqlite3_finalize(st);
    return out;
  }

  // Deletes the class, its memberships, and unlinks its sets (they become
  // open sets). Done explicitly: foreign-key enforcement is off, so the
  // schema's ON DELETE clauses are documentation, not behavior.
  bool deleteClass(long classId, long callerId, bool isAdmin) {
    std::lock_guard<std::mutex> l(mu_);
    sqlite3_stmt *st = nullptr;
    const char *sql = isAdmin ? "DELETE FROM classes WHERE id=?1"
                              : "DELETE FROM classes WHERE id=?1 AND owner_id=?2";
    if (sqlite3_prepare_v2(db_, sql, -1, &st, nullptr) != SQLITE_OK) return false;
    sqlite3_bind_int64(st, 1, classId);
    if (!isAdmin) sqlite3_bind_int64(st, 2, callerId);
    bool ok = sqlite3_step(st) == SQLITE_DONE && sqlite3_changes(db_) > 0;
    sqlite3_finalize(st);
    if (!ok) return false;
    const char *wipe[2] = {
        "DELETE FROM class_members WHERE class_id=?1",
        "UPDATE sets SET class_id=NULL WHERE class_id=?1"};
    for (const char *w : wipe) {
      if (sqlite3_prepare_v2(db_, w, -1, &st, nullptr) != SQLITE_OK) continue;
      sqlite3_bind_int64(st, 1, classId);
      sqlite3_step(st);
      sqlite3_finalize(st);
    }
    return true;
  }

  bool isMember(long classId, long userId) {
    std::lock_guard<std::mutex> l(mu_);
    sqlite3_stmt *st = nullptr;
    if (sqlite3_prepare_v2(db_,
                           "SELECT 1 FROM class_members WHERE class_id=?1 AND user_id=?2",
                           -1, &st, nullptr) != SQLITE_OK)
      return false;
    sqlite3_bind_int64(st, 1, classId);
    sqlite3_bind_int64(st, 2, userId);
    bool ok = sqlite3_step(st) == SQLITE_ROW;
    sqlite3_finalize(st);
    return ok;
  }

  // Idempotent: joining twice reports joined=false, never an error.
  bool joinClass(long classId, long userId, bool *joined) {
    std::lock_guard<std::mutex> l(mu_);
    sqlite3_stmt *st = nullptr;
    if (sqlite3_prepare_v2(db_,
                           "INSERT INTO class_members(class_id,user_id,joined_at)"
                           " VALUES(?1,?2,?3) ON CONFLICT(class_id,user_id)"
                           " DO NOTHING",
                           -1, &st, nullptr) != SQLITE_OK)
      return false;
    sqlite3_bind_int64(st, 1, classId);
    sqlite3_bind_int64(st, 2, userId);
    sqlite3_bind_int64(st, 3, (long)std::time(nullptr));
    bool ok = sqlite3_step(st) == SQLITE_DONE;
    if (ok && joined) *joined = sqlite3_changes(db_) > 0;
    sqlite3_finalize(st);
    return ok;
  }

  bool leaveClass(long classId, long userId, bool *left) {
    std::lock_guard<std::mutex> l(mu_);
    sqlite3_stmt *st = nullptr;
    if (sqlite3_prepare_v2(db_,
                           "DELETE FROM class_members WHERE class_id=?1 AND user_id=?2",
                           -1, &st, nullptr) != SQLITE_OK)
      return false;
    sqlite3_bind_int64(st, 1, classId);
    sqlite3_bind_int64(st, 2, userId);
    bool ok = sqlite3_step(st) == SQLITE_DONE;
    if (ok && left) *left = sqlite3_changes(db_) > 0;
    sqlite3_finalize(st);
    return ok;
  }

  std::vector<Member> listMembers(long classId) {
    std::vector<Member> out;
    std::lock_guard<std::mutex> l(mu_);
    sqlite3_stmt *st = nullptr;
    if (sqlite3_prepare_v2(db_,
                           "SELECT u.id,u.username,u.name,m.joined_at FROM class_members m"
                           " JOIN users u ON u.id=m.user_id"
                           " WHERE m.class_id=?1 ORDER BY m.joined_at,m.user_id",
                           -1, &st, nullptr) != SQLITE_OK)
      return out;
    sqlite3_bind_int64(st, 1, classId);
    while (sqlite3_step(st) == SQLITE_ROW) {
      Member m;
      m.userId = (long)sqlite3_column_int64(st, 0);
      m.username = (const char *)sqlite3_column_text(st, 1);
      m.name = (const char *)sqlite3_column_text(st, 2);
      m.joinedAt = (long)sqlite3_column_int64(st, 3);
      out.push_back(m);
    }
    sqlite3_finalize(st);
    return out;
  }

  bool deleteSet(long setId, long callerId, bool isAdmin) {
    std::lock_guard<std::mutex> l(mu_);
    sqlite3_stmt *st = nullptr;
    const char *sql = isAdmin ? "DELETE FROM sets WHERE id=?1"
                              : "DELETE FROM sets WHERE id=?1 AND owner_id=?2";
    if (sqlite3_prepare_v2(db_, sql, -1, &st, nullptr) != SQLITE_OK) return false;
    sqlite3_bind_int64(st, 1, setId);
    if (!isAdmin) sqlite3_bind_int64(st, 2, callerId);
    bool ok = sqlite3_step(st) == SQLITE_DONE && sqlite3_changes(db_) > 0;
    sqlite3_finalize(st);
    return ok;
  }

  // autoPass: -1 = not checked, 0 = fail, 1 = pass. hasScore guards
  // autoScore; autoDetails carries the counts JSON (never model coords).
  long createSubmission(long setId, long userId, int qIndex, const std::string &note,
                        const std::string &data, int autoPass, bool hasScore,
                        double autoScore, const std::string &autoDetails) {
    std::lock_guard<std::mutex> l(mu_);
    sqlite3_stmt *st = nullptr;
    if (sqlite3_prepare_v2(db_,
                           "INSERT INTO submissions(set_id,user_id,question_index,note,"
                           "data_json,created_at,auto_pass,auto_score,auto_details)"
                           " VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                           -1, &st, nullptr) != SQLITE_OK)
      return -1;
    sqlite3_bind_int64(st, 1, setId);
    sqlite3_bind_int64(st, 2, userId);
    sqlite3_bind_int(st, 3, qIndex);
    sqlite3_bind_text(st, 4, note.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 5, data.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(st, 6, (long)std::time(nullptr));
    if (autoPass < 0)
      sqlite3_bind_null(st, 7);
    else
      sqlite3_bind_int(st, 7, autoPass);
    if (hasScore)
      sqlite3_bind_double(st, 8, autoScore);
    else
      sqlite3_bind_null(st, 8);
    sqlite3_bind_text(st, 9, autoDetails.c_str(), -1, SQLITE_TRANSIENT);
    bool ok = sqlite3_step(st) == SQLITE_DONE;
    long id = ok ? (long)sqlite3_last_insert_rowid(db_) : -1;
    sqlite3_finalize(st);
    return id;
  }

  bool gradeSubmission(long id, const std::string &verdict, const std::string &remarks) {
    std::lock_guard<std::mutex> l(mu_);
    sqlite3_stmt *st = nullptr;
    if (sqlite3_prepare_v2(db_,
                           "UPDATE submissions SET verdict=?1,remarks=?2 WHERE id=?3",
                           -1, &st, nullptr) != SQLITE_OK)
      return false;
    sqlite3_bind_text(st, 1, verdict.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 2, remarks.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(st, 3, id);
    bool ok = sqlite3_step(st) == SQLITE_DONE && sqlite3_changes(db_) > 0;
    sqlite3_finalize(st);
    return ok;
  }

  bool updateSetQuestions(long setId, const std::string &questionsJson) {
    std::lock_guard<std::mutex> l(mu_);
    sqlite3_stmt *st = nullptr;
    if (sqlite3_prepare_v2(db_, "UPDATE sets SET questions_json=?1 WHERE id=?2", -1,
                           &st, nullptr) != SQLITE_OK)
      return false;
    sqlite3_bind_text(st, 1, questionsJson.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(st, 2, setId);
    bool ok = sqlite3_step(st) == SQLITE_DONE && sqlite3_changes(db_) > 0;
    sqlite3_finalize(st);
    return ok;
  }

  static void readSubmissionExtra(sqlite3_stmt *st, int base, Submission *s) {
    // base: index of verdict column; layout verdict,remarks,auto_pass,
    // auto_score,auto_details (5 columns).
    const unsigned char *v = sqlite3_column_text(st, base);
    const unsigned char *r = sqlite3_column_text(st, base + 1);
    s->verdict = v ? (const char *)v : "";
    s->remarks = r ? (const char *)r : "";
    if (sqlite3_column_type(st, base + 2) == SQLITE_NULL) {
      s->autoPass = -1;
    } else {
      s->autoPass = sqlite3_column_int(st, base + 2) ? 1 : 0;
    }
    if (sqlite3_column_type(st, base + 3) == SQLITE_NULL) {
      s->hasAutoScore = false;
      s->autoScore = 0;
    } else {
      s->hasAutoScore = true;
      s->autoScore = sqlite3_column_double(st, base + 3);
    }
    const unsigned char *d = sqlite3_column_text(st, base + 4);
    s->autoDetails = d ? (const char *)d : "";
  }

  std::vector<Submission> listSubmissions(long setId) {
    std::vector<Submission> out;
    std::lock_guard<std::mutex> l(mu_);
    sqlite3_stmt *st = nullptr;
    if (sqlite3_prepare_v2(db_,
                           "SELECT b.id,b.question_index,b.note,b.created_at,"
                           "u.username,u.name,b.verdict,b.remarks,b.auto_pass,"
                           "b.auto_score,b.auto_details FROM submissions b"
                           " JOIN users u ON u.id=b.user_id"
                           " WHERE b.set_id=?1 ORDER BY b.created_at,b.id",
                           -1, &st, nullptr) != SQLITE_OK)
      return out;
    sqlite3_bind_int64(st, 1, setId);
    while (sqlite3_step(st) == SQLITE_ROW) {
      Submission s;
      s.setId = setId;
      s.id = (long)sqlite3_column_int64(st, 0);
      s.questionIndex = sqlite3_column_int(st, 1);
      s.note = (const char *)sqlite3_column_text(st, 2);
      s.createdAt = (long)sqlite3_column_int64(st, 3);
      s.username = (const char *)sqlite3_column_text(st, 4);
      s.name = (const char *)sqlite3_column_text(st, 5);
      readSubmissionExtra(st, 6, &s);
      out.push_back(s);
    }
    sqlite3_finalize(st);
    return out;
  }

  bool getSubmission(long id, Submission *out) {
    std::lock_guard<std::mutex> l(mu_);
    sqlite3_stmt *st = nullptr;
    if (sqlite3_prepare_v2(db_,
                           "SELECT b.id,b.set_id,b.user_id,b.question_index,b.note,"
                           "b.data_json,b.created_at,s.code,u.username,u.name,"
                           "b.verdict,b.remarks,b.auto_pass,b.auto_score,b.auto_details"
                           " FROM submissions b JOIN sets s ON s.id=b.set_id"
                           " JOIN users u ON u.id=b.user_id WHERE b.id=?1",
                           -1, &st, nullptr) != SQLITE_OK)
      return false;
    sqlite3_bind_int64(st, 1, id);
    bool ok = false;
    if (sqlite3_step(st) == SQLITE_ROW) {
      out->id = (long)sqlite3_column_int64(st, 0);
      out->setId = (long)sqlite3_column_int64(st, 1);
      out->userId = (long)sqlite3_column_int64(st, 2);
      out->questionIndex = sqlite3_column_int(st, 3);
      out->note = (const char *)sqlite3_column_text(st, 4);
      out->dataJson = (const char *)sqlite3_column_text(st, 5);
      out->createdAt = (long)sqlite3_column_int64(st, 6);
      out->setCode = (const char *)sqlite3_column_text(st, 7);
      out->username = (const char *)sqlite3_column_text(st, 8);
      out->name = (const char *)sqlite3_column_text(st, 9);
      readSubmissionExtra(st, 10, out);
      ok = true;
    }
    sqlite3_finalize(st);
    return ok;
  }

  std::vector<Submission> listMySubmissions(long userId) {
    std::vector<Submission> out;
    std::lock_guard<std::mutex> l(mu_);
    sqlite3_stmt *st = nullptr;
    if (sqlite3_prepare_v2(db_,
                           "SELECT b.id,s.code,b.question_index,b.created_at,"
                           "b.verdict,b.remarks,b.auto_pass,b.auto_score,b.auto_details"
                           " FROM submissions b JOIN sets s ON s.id=b.set_id"
                           " WHERE b.user_id=?1 ORDER BY b.created_at DESC,b.id DESC",
                           -1, &st, nullptr) != SQLITE_OK)
      return out;
    sqlite3_bind_int64(st, 1, userId);
    while (sqlite3_step(st) == SQLITE_ROW) {
      Submission s;
      s.id = (long)sqlite3_column_int64(st, 0);
      s.setCode = (const char *)sqlite3_column_text(st, 1);
      s.questionIndex = sqlite3_column_int(st, 2);
      s.createdAt = (long)sqlite3_column_int64(st, 3);
      readSubmissionExtra(st, 4, &s);
      out.push_back(s);
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

// Teacher-chosen set codes: short, URL-safe, no slashes (they sit in paths).
bool validCode(const std::string &code) {
  if (code.size() < 3 || code.size() > 24) return false;
  for (char c : code) {
    if (!isalnum((unsigned char)c) && c != '-') return false;
  }
  return true;
}

bool isTeacher(const Db::User &u) { return u.role == "teacher" || u.role == "academics"; }
bool isAdmin(const Db::User &u) { return u.role == "academics"; }

// Splits /api/sets/<code>[/submissions] into (code, tail). False when the
// path is not under the prefix or the code segment is empty.
bool splitSetPath(const std::string &path, std::string *code, std::string *tail) {
  static const std::string pre = "/api/sets/";
  if (path.size() <= pre.size() || path.compare(0, pre.size(), pre) != 0) return false;
  std::string rest = path.substr(pre.size());
  size_t slash = rest.find('/');
  if (slash == std::string::npos) {
    *code = rest;
    *tail = "";
  } else {
    *code = rest.substr(0, slash);
    *tail = rest.substr(slash);
  }
  return !code->empty();
}

// Splits /api/classes/<code>[/join|/leave|/members|/sets] into (code, tail).
bool splitClassPath(const std::string &path, std::string *code, std::string *tail) {
  static const std::string pre = "/api/classes/";
  if (path.size() <= pre.size() || path.compare(0, pre.size(), pre) != 0) return false;
  std::string rest = path.substr(pre.size());
  size_t slash = rest.find('/');
  if (slash == std::string::npos) {
    *code = rest;
    *tail = "";
  } else {
    *code = rest.substr(0, slash);
    *tail = rest.substr(slash);
  }
  return !code->empty();
}

bool parseSubmissionId(const std::string &path, long *out) {
  static const std::string pre = "/api/submissions/";
  if (path.size() <= pre.size() || path.compare(0, pre.size(), pre) != 0) return false;
  std::string id = path.substr(pre.size());
  if (id.empty() || id.size() > 18) return false;
  for (char c : id)
    if (!isdigit((unsigned char)c)) return false;
  *out = std::stol(id);
  return *out > 0;
}

json parseStored(const std::string &s) {
  try {
    return json::parse(s);
  } catch (...) {
    return json(nullptr);
  }
}

bool validVerdict(const std::string &v) {
  return v == "pass" || v == "fail" || v == "" || v == "ungraded";
}

// Parses /api/sets/<code>/questions/<qi>/<action> where action is
// "model" or "check". qi must be a non-negative integer.
bool parseQuestionSubPath(const std::string &path, std::string *code, int *qi,
                          std::string *action) {
  static const std::string pre = "/api/sets/";
  if (path.size() <= pre.size() || path.compare(0, pre.size(), pre) != 0) return false;
  std::string rest = path.substr(pre.size());
  size_t s1 = rest.find('/');
  if (s1 == std::string::npos) return false;
  std::string c = rest.substr(0, s1);
  std::string tail = rest.substr(s1);  // /questions/<qi>/<action>
  static const std::string qp = "/questions/";
  if (tail.size() <= qp.size() || tail.compare(0, qp.size(), qp) != 0) return false;
  std::string after = tail.substr(qp.size());
  size_t s2 = after.find('/');
  if (s2 == std::string::npos) return false;
  std::string qiStr = after.substr(0, s2);
  std::string act = after.substr(s2 + 1);
  if (c.empty() || qiStr.empty() || !(act == "model" || act == "check")) return false;
  for (char ch : qiStr)
    if (!isdigit((unsigned char)ch)) return false;
  if (qiStr.size() > 6) return false;
  *code = c;
  *qi = std::stoi(qiStr);
  *action = act;
  return true;
}

// Parses /api/submissions/<id>/grade into id.
bool parseGradePath(const std::string &path, long *out) {
  static const std::string pre = "/api/submissions/";
  static const std::string suf = "/grade";
  if (path.size() <= pre.size() + suf.size() ||
      path.compare(0, pre.size(), pre) != 0 ||
      path.compare(path.size() - suf.size(), suf.size(), suf) != 0)
    return false;
  std::string id = path.substr(pre.size(), path.size() - pre.size() - suf.size());
  if (id.empty() || id.size() > 18) return false;
  for (char c : id)
    if (!isdigit((unsigned char)c)) return false;
  *out = std::stol(id);
  return *out > 0;
}

// ---- model-answer auto-check (strict) ----
// Compares a student snapshot against the teacher model. Visible entities
// only; DATUM_AXIS excluded (construction aid). Counts, types and
// positions must match within tolerance; any missing or extra entity
// fails. Returns counts only — never model coordinates.
struct VerifyOutcome {
  bool checked = false;
  bool pass = false;
  double score = 0;
  std::string reason;  // set when checked == false
  json details = json::object();
};

static double jsonNum(const json &o, const char *k, double dflt) {
  if (!o.is_object() || !o.contains(k)) return dflt;
  const json &v = o[k];
  if (v.is_number()) return v.get<double>();
  return dflt;
}

static std::string jsonStr(const json &o, const char *k) {
  if (!o.is_object() || !o.contains(k) || !o[k].is_string()) return "";
  return o[k].get<std::string>();
}

static double distMm(double ax, double ay, double bx, double by) {
  double dx = ax - bx, dy = ay - by;
  return std::sqrt(dx * dx + dy * dy);
}

static bool isTwoPointType(const std::string &t) {
  return t == "SEGMENT" || t == "LINE" || t == "RAY" || t == "DIMENSION";
}

VerifyOutcome compareDrawings(const json &modelData, const json &studentData) {
  const double kEpsMm = 0.5;
  const double kAngleEpsDeg = 2.0;
  VerifyOutcome r;
  std::vector<json> mEnts, sEnts;
  if (modelData.is_object() && modelData.contains("entities") &&
      modelData["entities"].is_array()) {
    for (const json &e : modelData["entities"]) {
      if (!e.is_object()) continue;
      if (e.contains("visible") && e["visible"].is_boolean() && !e["visible"].get<bool>())
        continue;
      if (jsonStr(e, "type") == "DATUM_AXIS") continue;
      mEnts.push_back(e);
    }
  }
  if (studentData.is_object() && studentData.contains("entities") &&
      studentData["entities"].is_array()) {
    for (const json &e : studentData["entities"]) {
      if (!e.is_object()) continue;
      if (e.contains("visible") && e["visible"].is_boolean() && !e["visible"].get<bool>())
        continue;
      if (jsonStr(e, "type") == "DATUM_AXIS") continue;
      sEnts.push_back(e);
    }
  }
  if (mEnts.empty()) {
    r.checked = false;
    r.reason = "empty_model";
    r.details = {{"model_count", 0},
                 {"student_count", (int)sEnts.size()},
                 {"matched", 0},
                 {"missing", 0},
                 {"extra", (int)sEnts.size()}};
    return r;
  }
  r.checked = true;
  std::vector<bool> used(sEnts.size(), false);
  int matched = 0;
  double maxErr = 0;
  std::map<std::string, json> perType;
  auto typeBucket = [&](const std::string &t) -> json & {
    auto it = perType.find(t);
    if (it == perType.end()) {
      perType[t] = {{"model", 0}, {"matched", 0}, {"missing", 0}};
      return perType[t];
    }
    return it->second;
  };
  for (const json &m : mEnts) {
    std::string t = jsonStr(m, "type");
    typeBucket(t)["model"] = (int)typeBucket(t)["model"] + 1;
    int best = -1;
    double bestErr = 1e18;
    for (size_t i = 0; i < sEnts.size(); i++) {
      if (used[i]) continue;
      const json &s = sEnts[i];
      if (jsonStr(s, "type") != t) continue;
      double err = 1e18;
      bool ok = false;
      if (t == "POINT") {
        err = distMm(jsonNum(m, "x", 0), jsonNum(m, "y", 0), jsonNum(s, "x", 0),
                     jsonNum(s, "y", 0));
        ok = err <= kEpsMm;
      } else if (t == "TEXT") {
        err = distMm(jsonNum(m, "x", 0), jsonNum(m, "y", 0), jsonNum(s, "x", 0),
                     jsonNum(s, "y", 0));
        ok = err <= kEpsMm && trimWs(jsonStr(m, "caption")) == trimWs(jsonStr(s, "caption"));
      } else if (isTwoPointType(t)) {
        double mx = jsonNum(m, "x", 0), my = jsonNum(m, "y", 0);
        double mx2 = jsonNum(m, "x2", 0), my2 = jsonNum(m, "y2", 0);
        double sx = jsonNum(s, "x", 0), sy = jsonNum(s, "y", 0);
        double sx2 = jsonNum(s, "x2", 0), sy2 = jsonNum(s, "y2", 0);
        double straight = std::max(distMm(mx, my, sx, sy), distMm(mx2, my2, sx2, sy2));
        double swapped = std::max(distMm(mx, my, sx2, sy2), distMm(mx2, my2, sx, sy));
        err = std::min(straight, swapped);
        ok = err <= kEpsMm;
      } else if (t == "CIRCLE") {
        double cd = distMm(jsonNum(m, "x", 0), jsonNum(m, "y", 0), jsonNum(s, "x", 0),
                           jsonNum(s, "y", 0));
        double rd = std::abs(jsonNum(m, "radius", 0) - jsonNum(s, "radius", 0));
        err = std::max(cd, rd);
        ok = err <= kEpsMm;
      } else if (t == "CIRCULAR_ARC") {
        double cd = distMm(jsonNum(m, "x", 0), jsonNum(m, "y", 0), jsonNum(s, "x", 0),
                           jsonNum(s, "y", 0));
        double rd = std::abs(jsonNum(m, "radius", 0) - jsonNum(s, "radius", 0));
        double sa = std::abs(jsonNum(m, "startAngle", 0) - jsonNum(s, "startAngle", 0));
        double ea = std::abs(jsonNum(m, "endAngle", 0) - jsonNum(s, "endAngle", 0));
        while (sa > 180) sa = std::abs(sa - 360);
        while (ea > 180) ea = std::abs(ea - 360);
        err = std::max(cd, rd);
        ok = err <= kEpsMm && sa <= kAngleEpsDeg && ea <= kAngleEpsDeg;
        if (ok) err = std::max(err, std::max(sa, ea) / 10.0);
      } else {
        double mx = jsonNum(m, "x", 0), my = jsonNum(m, "y", 0);
        double mx2 = jsonNum(m, "x2", 0), my2 = jsonNum(m, "y2", 0);
        double sx = jsonNum(s, "x", 0), sy = jsonNum(s, "y", 0);
        double sx2 = jsonNum(s, "x2", 0), sy2 = jsonNum(s, "y2", 0);
        bool has2 = (m.contains("x2") || m.contains("y2") || s.contains("x2") || s.contains("y2"));
        if (has2) {
          double straight = std::max(distMm(mx, my, sx, sy), distMm(mx2, my2, sx2, sy2));
          double swapped = std::max(distMm(mx, my, sx2, sy2), distMm(mx2, my2, sx, sy));
          err = std::min(straight, swapped);
        } else {
          err = distMm(mx, my, sx, sy);
        }
        ok = err <= kEpsMm;
      }
      if (ok && err < bestErr) {
        bestErr = err;
        best = (int)i;
      }
    }
    if (best >= 0) {
      used[best] = true;
      matched++;
      if (bestErr > maxErr) maxErr = bestErr;
      typeBucket(t)["matched"] = (int)typeBucket(t)["matched"] + 1;
    } else {
      typeBucket(t)["missing"] = (int)typeBucket(t)["missing"] + 1;
    }
  }
  int missing = (int)mEnts.size() - matched;
  int extra = 0;
  for (bool u : used)
    if (!u) extra++;
  r.pass = (missing == 0 && extra == 0);
  int denom = std::max((int)mEnts.size(), (int)sEnts.size());
  r.score = denom > 0 ? (double)matched / (double)denom : 1.0;
  json pt = json::object();
  for (auto &kv : perType) pt[kv.first] = kv.second;
  r.details = {{"model_count", (int)mEnts.size()},
               {"student_count", (int)sEnts.size()},
               {"matched", matched},
               {"missing", missing},
               {"extra", extra},
               {"max_err_mm", maxErr},
               {"per_type", pt}};
  return r;
}

// Strips model drawings for non-owners. Teachers who own the set (and
// admins) see full questions; everyone else gets has_model/check_enabled
// flags but never the model payload.
json filterQuestionsForRole(const json &questions, bool full) {
  json out = json::array();
  if (!questions.is_array()) return out;
  for (const json &q : questions) {
    if (!q.is_object()) {
      out.push_back(q);
      continue;
    }
    if (full) {
      json nq = q;
      bool has = nq.contains("model") && nq["model"].is_object();
      nq["has_model"] = has;
      if (!nq.contains("check_enabled")) nq["check_enabled"] = has;
      out.push_back(nq);
      continue;
    }
    json nq = json::object();
    if (q.contains("prompt")) nq["prompt"] = q["prompt"];
    if (q.contains("hint")) nq["hint"] = q["hint"];
    if (q.contains("starter")) nq["starter"] = q["starter"];
    bool has = q.contains("model") && q["model"].is_object();
    nq["has_model"] = has;
    bool enabled = false;
    if (q.contains("check_enabled") && q["check_enabled"].is_boolean())
      enabled = q["check_enabled"].get<bool>();
    else
      enabled = has;
    nq["check_enabled"] = enabled;
    out.push_back(nq);
  }
  return out;
}

json submissionAutoJson(const Db::Submission &b) {
  if (b.autoPass < 0) return json({{"checked", false}});
  json d = parseStored(b.autoDetails.empty() ? "{}" : b.autoDetails);
  if (!d.is_object()) d = json::object();
  json o = json({{"checked", true},
                 {"pass", b.autoPass == 1},
                 {"details", d}});
  if (b.hasAutoScore)
    o["score"] = b.autoScore;
  else
    o["score"] = nullptr;
  return o;
}

// Static file serving: resolve inside root, directory index or listing.
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
      // Directory listing.
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
          "<title>EduCAD</title></head><body><h1>EduCAD</h1><ul>";
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

// ---- Natural-language interpretation (student `/ words`, teacher /auto) ----
// POST /api/interpret turns one plain-language request into slash commands
// via the local model gateway (antigravity-manager.md). Browsers never see
// the key: it comes from server environment, else the manager's own file.
//   OPENAI_API_KEY  (preferred; else ~/.hermes/.env; missing key answers 503)
//   ANTIGRAVITY_URL (default http://127.0.0.1:8045)
//   EDUCAD_NL_MODEL (default gemini-3.8-flash-medium)
const size_t kInterpretMaxBody = 8192;
const size_t kInterpretMaxText = 2000;
const size_t kInterpretMaxPoints = 64;
const size_t kInterpretMaxCommands = 40;
const char *kDefaultGatewayUrl = "http://127.0.0.1:8045";
const char *kDefaultNlModel = "gemini-3.8-flash-medium";

std::string interpretSystemPrompt(const std::string &points, bool autoMode) {
  std::string p =
      "You translate plain drawing requests into EduCAD slash commands. "
      "Reply with ONLY a JSON object: {\"commands\": [\"...\"], \"reply\": \"...\"}.\n"
      "Coordinate plane: millimetres. y >= 0 is the elevation view (front, above "
      "the XY ground line); y < 0 is the plan view (top, below the line). Keep "
      "|x| and |y| under 120 unless asked otherwise. In Monge projection each "
      "corner's elevation x must equal its plan x.\n"
      "Commands (every line must start with /):\n"
      "/point <name> <x> <y> [role] — place a point. role: "
      "plan|elevation|both|profile (omit for auto).\n"
      "/line <from> <to> [bis] [role] — segment between named points.\n"
      "/ray <from> <to> [bis] [role] — ray from the first point through the "
      "second.\n"
      "/xline <from> <to> [bis] [role] — construction line through two points.\n"
      "/circle <center> <r> [bis] [role] — or /circle <x> <y> <r> [bis] [role].\n"
      "/arc <center> <r> <a1> <a2> [bis] [role] — or /arc <x> <y> <r> <a1> "
      "<a2> [bis] [role]; angles in degrees.\n"
      "/text <x> <y> <words...> — annotation.\n"
      "/dimension <from> <to> [bis] [role] — measured span.\n"
      "/polygon <p1> <p2> <p3> [p4 ...] — closed chain, needs existing points.\n"
      "/polyline <p1> <p2> [p3 ...] — open chain for curves, needs points.\n"
      "/ellipse <center> <rx> <ry> [n] [bis] [role] — or /ellipse <x> <y> "
      "<rx> <ry> [n] [bis] [role].\n"
      "/hatch <x1> <y1> <x2> <y2> <spacing> [angle] [bis] [role] — section "
      "hatching in a rect.\n"
      "/rename <old> <new> — rename. /delete <name> — delete. "
      "/style <name> <bis> [role] — restyle. /datum [x1] [x2] — ground axis.\n"
      "/clear — empty sheet. /undo — undo last change. "
      "/demo <line|points|prism|3view|square>. "
      "/tutorial <square|prism>. /check. /mode <edit|view>.\n"
      "BIS line styles: A B E G H K (default B; hidden edges E, centre lines "
      "G).\n"
      "Rules: create every point with /point before referencing it. Use short "
      "letter names (a, b, c...). Never invent commands outside this list. At "
      "most 40 lines. If the request is vague, impossible, or needs "
      "information you lack, return {\"commands\": [], \"reply\": \"<one or two "
      "sentences saying what is missing or why it cannot be drawn>\"}.";
  if (autoMode) {
    p += "\nGoal: draw a complete model answer for an engineering-drawing "
         "question. Prefer full closed geometry over fragments.";
  }
  if (!points.empty()) {
    p += "\nPoints already on the sheet: " + points +
         ". Reuse them by name when the request means them.";
  }
  return p;
}

// The gateway key: explicit environment wins; otherwise read the manager's
// single credential file (~/.hermes/.env, KEY=VALUE lines). Empty when
// neither exists, which the route reports as 503.
std::string gatewayApiKey() {
  const char *env = std::getenv("OPENAI_API_KEY");
  if (env && *env) return std::string(env);
  const char *home = std::getenv("HOME");
  if (!home || !*home) return "";
  std::ifstream f(std::string(home) + "/.hermes/.env");
  if (!f.is_open()) return "";
  std::string line;
  while (std::getline(f, line)) {
    size_t a = line.find_first_not_of(" \t\r\n");
    if (a == std::string::npos || line[a] == '#') continue;
    size_t e = line.find('=', a);
    if (e == std::string::npos) continue;
    std::string k = line.substr(a, e - a);
    size_t ke = k.find_last_not_of(" \t");
    if (ke != std::string::npos) k = k.substr(0, ke + 1);
    if (k != "OPENAI_API_KEY") continue;
    std::string v = line.substr(e + 1);
    size_t va = v.find_first_not_of(" \t");
    size_t vz = v.find_last_not_of(" \t\r\n");
    if (va == std::string::npos) continue;
    v = v.substr(va, vz - va + 1);
    if (v.size() >= 2 &&
        ((v.front() == '"' && v.back() == '"') ||
         (v.front() == '\'' && v.back() == '\''))) {
      v = v.substr(1, v.size() - 2);
    }
    if (!v.empty()) return v;
  }
  return "";
}

bool splitGatewayUrl(const std::string &url, std::string *host, int *port) {
  const std::string pre = "http://";
  if (url.compare(0, pre.size(), pre) != 0) return false;
  std::string rest = url.substr(pre.size());
  size_t slash = rest.find('/');
  std::string hp = (slash == std::string::npos) ? rest : rest.substr(0, slash);
  if (hp.empty()) return false;
  size_t colon = hp.find(':');
  *host = (colon == std::string::npos) ? hp : hp.substr(0, colon);
  *port = 80;
  if (colon != std::string::npos) {
    try {
      *port = std::stoi(hp.substr(colon + 1));
    } catch (...) {
      return false;
    }
  }
  return !host->empty() && *port > 0 && *port < 65536;
}

bool extractJsonObject(const std::string &text, json *out) {
  size_t a = text.find('{');
  size_t b = text.rfind('}');
  if (a == std::string::npos || b == std::string::npos || b <= a) return false;
  try {
    *out = json::parse(text.substr(a, b - a + 1));
  } catch (...) {
    return false;
  }
  return out->is_object();
}

// One chat completion against the local gateway. Returns the assistant text.
bool gatewayChat(const std::string &system, const std::string &userText,
                 std::string *content) {
  const char *urlEnv = std::getenv("ANTIGRAVITY_URL");
  const char *modelEnv = std::getenv("EDUCAD_NL_MODEL");
  std::string key = gatewayApiKey();
  if (key.empty()) return false;
  std::string host;
  int port = 0;
  if (!splitGatewayUrl(urlEnv && *urlEnv ? urlEnv : kDefaultGatewayUrl, &host,
                       &port)) {
    return false;
  }
  std::string model =
      (modelEnv && *modelEnv) ? modelEnv : kDefaultNlModel;
  httplib::Client cli(host.c_str(), port);
  cli.set_connection_timeout(10, 0);
  cli.set_read_timeout(30, 0);
  cli.set_write_timeout(10, 0);
  json payload = {{"model", model},
                  {"temperature", 0.2},
                  {"max_tokens", 1200},
                  {"messages",
                   {{{"role", "system"}, {"content", system}},
                    {{"role", "user"}, {"content", userText}}}}};
  httplib::Headers headers = {{"Authorization", "Bearer " + key},
                              {"Content-Type", "application/json"}};
  auto res = cli.Post("/v1/chat/completions", headers, payload.dump(),
                      "application/json");
  if (!res || res->status != 200) return false;
  json body;
  try {
    body = json::parse(res->body);
  } catch (...) {
    return false;
  }
  try {
    *content = body["choices"][0]["message"]["content"].get<std::string>();
  } catch (...) {
    return false;
  }
  return !content->empty();
}

void setupRoutes(httplib::Server &svr, Db &db, const fs::path &root) {
  using HR = httplib::Server::HandlerResponse;
  // httplib defaults to SO_REUSEPORT, which lets a second server share a busy
  // port instead of failing. Use plain SO_REUSEADDR so EADDRINUSE surfaces and
  // the busy-port retry in main() works.
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
      } else if (path == "/api/interpret") {
        known = true;
        allowed = (m == "POST");
      } else if (path == "/api/drawings") {
        known = true;
        allowed = (m == "GET" || m == "POST");
      } else if (path == "/api/progress") {
        known = true;
        allowed = (m == "GET");
      } else if (path == "/api/sets") {
        known = true;
        allowed = (m == "GET" || m == "POST");
      } else if (path == "/api/classes") {
        known = true;
        allowed = (m == "GET" || m == "POST");
      } else if (path == "/api/submissions/mine") {
        known = true;
        allowed = (m == "GET");
      } else if (path.rfind("/api/sets/", 0) == 0 && path.size() > 10) {
        known = true;
        std::string scode, stail;
        splitSetPath(path, &scode, &stail);
        if (stail == "/verify") {
          allowed = (m == "POST");
        } else if (stail == "/submissions") {
          // DELETE falls through to the set handler (404); PUT stays 405.
          allowed = (m == "GET" || m == "POST" || m == "DELETE");
        } else if (stail.rfind("/questions/", 0) == 0) {
          std::string qc;
          int qqi = 0;
          std::string qact;
          if (parseQuestionSubPath(path, &qc, &qqi, &qact)) {
            if (qact == "model")
              allowed = (m == "PUT" || m == "DELETE");
            else
              allowed = (m == "PUT");
          } else {
            allowed = (m == "GET" || m == "POST" || m == "DELETE");
          }
        } else if (stail.empty()) {
          // POST falls through to the router (404); PUT stays 405.
          allowed = (m == "GET" || m == "POST" || m == "DELETE");
        } else {
          allowed = (m == "GET" || m == "POST" || m == "DELETE");
        }
      } else if (path.rfind("/api/classes/", 0) == 0 && path.size() > 13) {
        known = true;
        allowed = (m == "GET" || m == "POST" || m == "DELETE");
      } else if (path.rfind("/api/submissions/", 0) == 0 && path.size() > 17) {
        known = true;
        long gid = 0;
        if (parseGradePath(path, &gid)) {
          allowed = (m == "PUT");
        } else {
          allowed = (m == "GET");
        }
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
  svr.Post("/api/interpret", [&](const httplib::Request &req, httplib::Response &res) {
    Db::User user;
    if (!requireAuth(db, req, res, &user)) return;
    json body;
    if (!jsonBody(req, res, kInterpretMaxBody, &body)) return;
    if (!body.contains("text") || !body["text"].is_string()) {
      sendJson(res, 400, {{"ok", false}, {"error", "bad text"}});
      return;
    }
    std::string text = body["text"].get<std::string>();
    if (text.empty() || text.size() > kInterpretMaxText) {
      sendJson(res, 400, {{"ok", false}, {"error", "bad text"}});
      return;
    }
    std::string mode = "draw";
    if (body.contains("mode")) {
      if (!body["mode"].is_string()) {
        sendJson(res, 400, {{"ok", false}, {"error", "bad mode"}});
        return;
      }
      mode = body["mode"].get<std::string>();
      if (mode != "draw" && mode != "auto") {
        sendJson(res, 400, {{"ok", false}, {"error", "bad mode"}});
        return;
      }
    }
    std::string points;
    if (body.contains("points")) {
      if (!body["points"].is_array()) {
        sendJson(res, 400, {{"ok", false}, {"error", "bad points"}});
        return;
      }
      size_t n = 0;
      for (const auto &q : body["points"]) {
        if (!q.is_string()) {
          sendJson(res, 400, {{"ok", false}, {"error", "bad points"}});
          return;
        }
        if (n >= kInterpretMaxPoints) break;
        if (!points.empty()) points += ", ";
        points += q.get<std::string>().substr(0, 40);
        n++;
      }
    }
    if (gatewayApiKey().empty()) {
      sendJson(res, 503, {{"ok", false}, {"error", "interpret_unavailable"}});
      return;
    }
    std::string content;
    if (!gatewayChat(interpretSystemPrompt(points, mode == "auto"), text,
                     &content)) {
      sendJson(res, 502, {{"ok", false}, {"error", "interpret_failed"}});
      return;
    }
    json ans;
    if (!extractJsonObject(content, &ans)) {
      sendJson(res, 200,
               {{"ok", true},
                {"commands", json::array()},
                {"reply", "The model gave an unusable answer — try shorter, "
                          "concrete words (names, mm, shapes)."}});
      return;
    }
    json commands = json::array();
    if (ans.contains("commands") && ans["commands"].is_array()) {
      for (const auto &c : ans["commands"]) {
        if (commands.size() >= kInterpretMaxCommands) break;
        if (!c.is_string()) continue;
        std::string line = c.get<std::string>();
        if (line.size() > 1 && line[0] == '/' && line.size() <= 300) {
          commands.push_back(line);
        }
      }
    }
    std::string reply;
    if (ans.contains("reply") && ans["reply"].is_string()) {
      reply = ans["reply"].get<std::string>().substr(0, 600);
    }
    sendJson(res, 200, {{"ok", true}, {"commands", commands}, {"reply", reply}});
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

  // Normalize + validate the questions array for POST /api/sets.
  // On success out holds canonical JSON; on failure err names the problem.
  auto normalizeQuestions = [](const json &body, std::string *out, std::string *err) {
    if (!body.contains("questions") || !body["questions"].is_array() ||
        body["questions"].empty() || body["questions"].size() > 50) {
      *err = "bad questions";
      return false;
    }
    json arr = json::array();
    for (const json &q : body["questions"]) {
      if (!q.is_object() || !q.contains("prompt") || !q["prompt"].is_string()) {
        *err = "bad questions";
        return false;
      }
      std::string prompt = trimWs(q["prompt"].get<std::string>());
      if (prompt.empty() || prompt.size() > 2000) {
        *err = "bad questions";
        return false;
      }
      json nq = {{"prompt", prompt}};
      if (q.contains("hint")) {
        if (!q["hint"].is_string()) {
          *err = "bad questions";
          return false;
        }
        std::string hint = trimWs(q["hint"].get<std::string>());
        if (hint.size() > 500) hint.resize(500);
        nq["hint"] = hint;
      }
      if (q.contains("starter") && !q["starter"].is_null()) {
        if (!q["starter"].is_object()) {
          *err = "bad questions";
          return false;
        }
        nq["starter"] = q["starter"];
      }
      // Optional model answer (teacher drawing snapshot) + auto-check
      // toggle. Model payloads are teacher-only; students never receive
      // them (see filterQuestionsForRole).
      bool hasModel = false;
      if (q.contains("model") && !q["model"].is_null()) {
        if (!q["model"].is_object()) {
          *err = "bad questions";
          return false;
        }
        nq["model"] = q["model"];
        hasModel = true;
      }
      if (q.contains("check_enabled") && !q["check_enabled"].is_null()) {
        if (!q["check_enabled"].is_boolean()) {
          *err = "bad questions";
          return false;
        }
        nq["check_enabled"] = q["check_enabled"];
      } else if (hasModel) {
        nq["check_enabled"] = true;
      }
      arr.push_back(nq);
    }
    *out = arr.dump();
    return true;
  };
  svr.Post("/api/sets", [&](const httplib::Request &req, httplib::Response &res) {
    Db::User user;
    if (!requireAuth(db, req, res, &user)) return;
    if (!isTeacher(user)) {
      sendJson(res, 403, {{"ok", false}, {"error", "teachers only"}});
      return;
    }
    json body;
    if (!jsonBody(req, res, kSaveMaxBody, &body)) return;
    std::string code = (body.contains("code") && body["code"].is_string())
                           ? body["code"].get<std::string>()
                           : "";
    if (!validCode(code)) {
      sendJson(res, 400, {{"ok", false}, {"error", "bad code"}});
      return;
    }
    std::string title = "Untitled set";
    if (body.contains("title")) {
      if (!body["title"].is_string()) {
        sendJson(res, 400, {{"ok", false}, {"error", "invalid title"}});
        return;
      }
      title = trimWs(body["title"].get<std::string>());
      if (title.empty()) title = "Untitled set";
      if (title.size() > 200) title.resize(200);
    }
    std::string questions, qerr;
    if (!normalizeQuestions(body, &questions, &qerr)) {
      sendJson(res, 400, {{"ok", false}, {"error", qerr}});
      return;
    }
    // Optional class scope: posting into a class needs an existing class
    // the caller owns (admins may post anywhere). Absent = open set.
    long classId = 0;
    if (body.contains("class_code") && !body["class_code"].is_null()) {
      if (!body["class_code"].is_string()) {
        sendJson(res, 400, {{"ok", false}, {"error", "bad class"}});
        return;
      }
      std::string cc = trimWs(body["class_code"].get<std::string>());
      if (!cc.empty()) {
        Db::Class cls;
        if (!validCode(cc) || !db.getClassByCode(cc, &cls)) {
          sendJson(res, 404, {{"ok", false}, {"error", "no such class"}});
          return;
        }
        if (cls.ownerId != user.id && !isAdmin(user)) {
          sendJson(res, 403, {{"ok", false}, {"error", "not your class"}});
          return;
        }
        classId = cls.id;
      }
    }
    long id = db.createSet(user.id, code, title, questions, classId);
    if (id == -2) {
      sendJson(res, 409, {{"ok", false}, {"error", "code taken"}});
      return;
    }
    if (id < 0) {
      sendJson(res, 500, {{"ok", false}, {"error", "cannot save set"}});
      return;
    }
    sendJson(res, 201, {{"ok", true}, {"id", id}, {"code", code}});
  });
  // Shared list-item shape for every sets listing (feed, class sets).
  auto setItem = [](const Db::Set &s) {
    int nq = 0;
    json q = parseStored(s.questionsJson);
    if (q.is_array()) nq = (int)q.size();
    return json({{"id", s.id},
                 {"code", s.code},
                 {"title", s.title},
                 {"nquestions", nq},
                 {"owner", s.ownerName},
                 {"class_code", s.classCode},
                 {"class_title", s.classTitle},
                 {"created_at", s.createdAt}});
  };
  svr.Get("/api/sets", [&](const httplib::Request &req, httplib::Response &res) {
    Db::User user;
    if (!requireAuth(db, req, res, &user)) return;
    json arr = json::array();
    if (isAdmin(user)) {
      for (const Db::Set &s : db.listSets(-1)) arr.push_back(setItem(s));
    } else if (isTeacher(user)) {
      for (const Db::Set &s : db.listSets(user.id)) arr.push_back(setItem(s));
    } else {
      for (const Db::Set &s : db.listSetsForStudent(user.id)) arr.push_back(setItem(s));
    }
    sendJson(res, 200, {{"ok", true}, {"sets", arr}});
  });
  svr.Get(R"(/api/sets/([^/]+))", [&](const httplib::Request &req, httplib::Response &res) {
    Db::User user;
    if (!requireAuth(db, req, res, &user)) return;
    std::string code, tail;
    Db::Set s;
    if (!splitSetPath(req.path, &code, &tail) || !tail.empty() || !validCode(code) ||
        !db.getSetByCode(code, &s)) {
      sendJson(res, 404, {{"ok", false}, {"error", "not found"}});
      return;
    }
    bool full = (s.ownerId == user.id) || isAdmin(user);
    sendJson(res, 200, {{"ok", true},
                        {"id", s.id},
                        {"code", s.code},
                        {"title", s.title},
                        {"questions", filterQuestionsForRole(parseStored(s.questionsJson), full)},
                        {"owner", s.ownerName},
                        {"class_code", s.classCode},
                        {"class_title", s.classTitle},
                        {"created_at", s.createdAt}});
  });
  svr.Delete(R"(/api/sets/([^/]+))", [&](const httplib::Request &req, httplib::Response &res) {
    Db::User user;
    if (!requireAuth(db, req, res, &user)) return;
    std::string code, tail;
    Db::Set s;
    if (!splitSetPath(req.path, &code, &tail) || !tail.empty() || !validCode(code) ||
        !db.getSetByCode(code, &s)) {
      sendJson(res, 404, {{"ok", false}, {"error", "not found"}});
      return;
    }
    if (s.ownerId != user.id && !isAdmin(user)) {
      sendJson(res, 403, {{"ok", false}, {"error", "not your set"}});
      return;
    }
    if (!db.deleteSet(s.id, user.id, isAdmin(user))) {
      sendJson(res, 404, {{"ok", false}, {"error", "not found"}});
      return;
    }
    sendJson(res, 200, {{"ok", true}});
  });
  svr.Post(R"(/api/sets/([^/]+)/submissions)", [&](const httplib::Request &req,
                                                  httplib::Response &res) {
    Db::User user;
    if (!requireAuth(db, req, res, &user)) return;
    std::string code, tail;
    Db::Set s;
    if (!splitSetPath(req.path, &code, &tail) || tail != "/submissions" ||
        !validCode(code) || !db.getSetByCode(code, &s)) {
      sendJson(res, 404, {{"ok", false}, {"error", "not found"}});
      return;
    }
    json body;
    if (!jsonBody(req, res, kSaveMaxBody, &body)) return;
    json questions = parseStored(s.questionsJson);
    int nq = questions.is_array() ? (int)questions.size() : 0;
    int qi = 0;
    if (body.contains("question_index")) {
      // Wide parse: a huge integer must 400, never throw out of the worker.
      long long qll = -1;
      try {
        if (!body["question_index"].is_number_integer()) throw std::out_of_range("nan");
        qll = body["question_index"].get<long long>();
      } catch (...) {
        sendJson(res, 400, {{"ok", false}, {"error", "bad question"}});
        return;
      }
      if (qll < 0 || qll >= nq) {
        sendJson(res, 400, {{"ok", false}, {"error", "bad question"}});
        return;
      }
      qi = (int)qll;
    } else if (nq < 1) {
      sendJson(res, 400, {{"ok", false}, {"error", "bad question"}});
      return;
    }
    if (qi < 0 || qi >= nq) {
      sendJson(res, 400, {{"ok", false}, {"error", "bad question"}});
      return;
    }
    if (!body.contains("data") || !body["data"].is_object()) {
      sendJson(res, 400, {{"ok", false}, {"error", "missing data"}});
      return;
    }
    std::string note;
    if (body.contains("note")) {
      if (!body["note"].is_string()) {
        sendJson(res, 400, {{"ok", false}, {"error", "bad note"}});
        return;
      }
      note = body["note"].get<std::string>();
      if (note.size() > 500) note.resize(500);
    }
    // Strict auto-check against the model answer (when the teacher
    // enabled it). The verdict is stored with the submission and
    // returned here; the model itself is never exposed.
    int autoPass = -1;
    bool hasScore = false;
    double autoScore = 0;
    std::string autoDetails;
    json autoJson = json({{"checked", false}});
    {
      const json &q = questions[(size_t)qi];
      bool enabled = false;
      if (q.contains("check_enabled") && q["check_enabled"].is_boolean())
        enabled = q["check_enabled"].get<bool>();
      else if (q.contains("model") && q["model"].is_object())
        enabled = true;
      if (enabled && q.contains("model") && q["model"].is_object()) {
        VerifyOutcome vo = compareDrawings(q["model"], body["data"]);
        if (vo.checked) {
          autoPass = vo.pass ? 1 : 0;
          hasScore = true;
          autoScore = vo.score;
          autoDetails = vo.details.dump();
          autoJson = json({{"checked", true},
                           {"pass", vo.pass},
                           {"score", vo.score},
                           {"details", vo.details}});
        }
      }
    }
    long id = db.createSubmission(s.id, user.id, qi, note, body["data"].dump(), autoPass,
                                  hasScore, autoScore, autoDetails);
    if (id < 0) {
      sendJson(res, 500, {{"ok", false}, {"error", "cannot save submission"}});
      return;
    }
    sendJson(res, 201, {{"ok", true}, {"id", id}, {"auto", autoJson}});
  });
  svr.Get(R"(/api/sets/([^/]+)/submissions)", [&](const httplib::Request &req,
                                                 httplib::Response &res) {
    Db::User user;
    if (!requireAuth(db, req, res, &user)) return;
    std::string code, tail;
    Db::Set s;
    if (!splitSetPath(req.path, &code, &tail) || tail != "/submissions" ||
        !validCode(code) || !db.getSetByCode(code, &s)) {
      sendJson(res, 404, {{"ok", false}, {"error", "not found"}});
      return;
    }
    if (s.ownerId != user.id && !isAdmin(user)) {
      sendJson(res, 403, {{"ok", false}, {"error", "not your set"}});
      return;
    }
    json arr = json::array();
    for (const Db::Submission &b : db.listSubmissions(s.id)) {
      arr.push_back({{"id", b.id},
                     {"username", b.username},
                     {"name", b.name},
                     {"question_index", b.questionIndex},
                     {"note", b.note},
                     {"verdict", b.verdict},
                     {"remarks", b.remarks},
                     {"auto", submissionAutoJson(b)},
                     {"created_at", b.createdAt}});
    }
    sendJson(res, 200, {{"ok", true}, {"submissions", arr}});
  });
  svr.Get("/api/submissions/mine", [&](const httplib::Request &req, httplib::Response &res) {
    Db::User user;
    if (!requireAuth(db, req, res, &user)) return;
    json arr = json::array();
    for (const Db::Submission &b : db.listMySubmissions(user.id)) {
      arr.push_back({{"id", b.id},
                     {"set_code", b.setCode},
                     {"question_index", b.questionIndex},
                     {"verdict", b.verdict},
                     {"remarks", b.remarks},
                     {"auto", submissionAutoJson(b)},
                     {"created_at", b.createdAt}});
    }
    sendJson(res, 200, {{"ok", true}, {"submissions", arr}});
  });
  svr.Get(R"(/api/submissions/(\d+))", [&](const httplib::Request &req, httplib::Response &res) {
    Db::User user;
    if (!requireAuth(db, req, res, &user)) return;
    long id = 0;
    Db::Submission b;
    Db::Set s;
    if (!parseSubmissionId(req.path, &id) || !db.getSubmission(id, &b) ||
        !db.getSetByCode(b.setCode, &s)) {
      sendJson(res, 404, {{"ok", false}, {"error", "not found"}});
      return;
    }
    if (s.ownerId != user.id && !isAdmin(user) && b.userId != user.id) {
      sendJson(res, 404, {{"ok", false}, {"error", "not found"}});
      return;
    }
    sendJson(res, 200, {{"ok", true},
                        {"id", b.id},
                        {"set_code", b.setCode},
                        {"question_index", b.questionIndex},
                        {"username", b.username},
                        {"name", b.name},
                        {"note", b.note},
                        {"data", parseStored(b.dataJson)},
                        {"verdict", b.verdict},
                        {"remarks", b.remarks},
                        {"auto", submissionAutoJson(b)},
                        {"created_at", b.createdAt}});
  });
  // Grade a submission: teacher verdict (pass/fail/ungraded) + remarks.
  // Only the set owner (or admin) may grade; the submitter reads the
  // grade via GET /api/submissions/:id and /mine.
  svr.Put(R"(/api/submissions/(\d+)/grade)", [&](const httplib::Request &req,
                                                 httplib::Response &res) {
    Db::User user;
    if (!requireAuth(db, req, res, &user)) return;
    long id = 0;
    Db::Submission b;
    Db::Set s;
    if (!parseGradePath(req.path, &id) || !db.getSubmission(id, &b) ||
        !db.getSetByCode(b.setCode, &s)) {
      sendJson(res, 404, {{"ok", false}, {"error", "not found"}});
      return;
    }
    if (s.ownerId != user.id && !isAdmin(user)) {
      sendJson(res, 403, {{"ok", false}, {"error", "not your set"}});
      return;
    }
    json body;
    if (!jsonBody(req, res, kSaveMaxBody, &body)) return;
    std::string verdict;
    if (body.contains("verdict") && !body["verdict"].is_null()) {
      if (!body["verdict"].is_string()) {
        sendJson(res, 400, {{"ok", false}, {"error", "bad verdict"}});
        return;
      }
      verdict = trimWs(body["verdict"].get<std::string>());
      if (verdict == "ungraded") verdict = "";
      if (!validVerdict(verdict)) {
        sendJson(res, 400, {{"ok", false}, {"error", "bad verdict"}});
        return;
      }
    }
    std::string remarks;
    if (body.contains("remarks") && !body["remarks"].is_null()) {
      if (!body["remarks"].is_string()) {
        sendJson(res, 400, {{"ok", false}, {"error", "bad remarks"}});
        return;
      }
      remarks = body["remarks"].get<std::string>();
      if (remarks.size() > 2000) remarks.resize(2000);
    }
    if (!db.gradeSubmission(id, verdict, remarks)) {
      sendJson(res, 404, {{"ok", false}, {"error", "not found"}});
      return;
    }
    sendJson(res, 200, {{"ok", true}, {"id", id}, {"verdict", verdict}});
  });
  // Verify a drawing against the model answer without revealing it.
  // Any logged-in user may verify; the response carries pass/fail +
  // counts only, never model coordinates.
  svr.Post(R"(/api/sets/([^/]+)/verify)", [&](const httplib::Request &req,
                                              httplib::Response &res) {
    Db::User user;
    if (!requireAuth(db, req, res, &user)) return;
    std::string code, tail;
    Db::Set s;
    if (!splitSetPath(req.path, &code, &tail) || tail != "/verify" ||
        !validCode(code) || !db.getSetByCode(code, &s)) {
      sendJson(res, 404, {{"ok", false}, {"error", "not found"}});
      return;
    }
    json body;
    if (!jsonBody(req, res, kSaveMaxBody, &body)) return;
    json questions = parseStored(s.questionsJson);
    int nq = questions.is_array() ? (int)questions.size() : 0;
    long long qll = -1;
    try {
      if (!body.contains("question_index") ||
          !body["question_index"].is_number_integer())
        throw std::out_of_range("nan");
      qll = body["question_index"].get<long long>();
    } catch (...) {
      sendJson(res, 400, {{"ok", false}, {"error", "bad question"}});
      return;
    }
    if (qll < 0 || qll >= nq) {
      sendJson(res, 400, {{"ok", false}, {"error", "bad question"}});
      return;
    }
    if (!body.contains("data") || !body["data"].is_object()) {
      sendJson(res, 400, {{"ok", false}, {"error", "missing data"}});
      return;
    }
    const json &q = questions[(size_t)qll];
    bool enabled = false;
    if (q.contains("check_enabled") && q["check_enabled"].is_boolean())
      enabled = q["check_enabled"].get<bool>();
    else if (q.contains("model") && q["model"].is_object())
      enabled = true;
    if (!enabled) {
      sendJson(res, 200, {{"ok", true}, {"checked", false}, {"reason", "disabled"}});
      return;
    }
    if (!q.contains("model") || !q["model"].is_object()) {
      sendJson(res, 200, {{"ok", true}, {"checked", false}, {"reason", "no_model"}});
      return;
    }
    VerifyOutcome vo = compareDrawings(q["model"], body["data"]);
    if (!vo.checked) {
      sendJson(res, 200,
               {{"ok", true}, {"checked", false}, {"reason", vo.reason}, {"details", vo.details}});
      return;
    }
    sendJson(res, 200, {{"ok", true},
                        {"checked", true},
                        {"pass", vo.pass},
                        {"score", vo.score},
                        {"details", vo.details}});
  });
  // Attach / replace the model answer for one question from the
  // teacher's current sheet snapshot. Owner (or admin) only.
  auto modelUpsert = [&](const httplib::Request &req, httplib::Response &res) {
    Db::User user;
    if (!requireAuth(db, req, res, &user)) return;
    std::string code, action;
    int qi = 0;
    Db::Set s;
    if (!parseQuestionSubPath(req.path, &code, &qi, &action) || action != "model" ||
        !validCode(code) || !db.getSetByCode(code, &s)) {
      sendJson(res, 404, {{"ok", false}, {"error", "not found"}});
      return;
    }
    if (s.ownerId != user.id && !isAdmin(user)) {
      sendJson(res, 403, {{"ok", false}, {"error", "not your set"}});
      return;
    }
    json questions = parseStored(s.questionsJson);
    if (!questions.is_array() || qi < 0 || qi >= (int)questions.size()) {
      sendJson(res, 404, {{"ok", false}, {"error", "not found"}});
      return;
    }
    json body;
    if (!jsonBody(req, res, kSaveMaxBody, &body)) return;
    if (!body.contains("data") || !body["data"].is_object()) {
      sendJson(res, 400, {{"ok", false}, {"error", "missing data"}});
      return;
    }
    questions[(size_t)qi]["model"] = body["data"];
    if (!questions[(size_t)qi].contains("check_enabled"))
      questions[(size_t)qi]["check_enabled"] = true;
    if (!db.updateSetQuestions(s.id, questions.dump())) {
      sendJson(res, 500, {{"ok", false}, {"error", "cannot save model"}});
      return;
    }
    sendJson(res, 200, {{"ok", true}, {"has_model", true}});
  };
  svr.Put(R"(/api/sets/([^/]+)/questions/(\d+)/model)", modelUpsert);
  svr.Delete(R"(/api/sets/([^/]+)/questions/(\d+)/model)",
             [&](const httplib::Request &req, httplib::Response &res) {
               Db::User user;
               if (!requireAuth(db, req, res, &user)) return;
               std::string code, action;
               int qi = 0;
               Db::Set s;
               if (!parseQuestionSubPath(req.path, &code, &qi, &action) ||
                   action != "model" || !validCode(code) || !db.getSetByCode(code, &s)) {
                 sendJson(res, 404, {{"ok", false}, {"error", "not found"}});
                 return;
               }
               if (s.ownerId != user.id && !isAdmin(user)) {
                 sendJson(res, 403, {{"ok", false}, {"error", "not your set"}});
                 return;
               }
               json questions = parseStored(s.questionsJson);
               if (!questions.is_array() || qi < 0 || qi >= (int)questions.size()) {
                 sendJson(res, 404, {{"ok", false}, {"error", "not found"}});
                 return;
               }
               questions[(size_t)qi].erase("model");
               questions[(size_t)qi]["check_enabled"] = false;
               if (!db.updateSetQuestions(s.id, questions.dump())) {
                 sendJson(res, 500, {{"ok", false}, {"error", "cannot clear model"}});
                 return;
               }
               sendJson(res, 200, {{"ok", true}, {"has_model", false}});
             });
  // Toggle the per-question auto-check. The model is never revealed;
  // this only switches strict pass/fail checking on or off.
  svr.Put(R"(/api/sets/([^/]+)/questions/(\d+)/check)",
          [&](const httplib::Request &req, httplib::Response &res) {
            Db::User user;
            if (!requireAuth(db, req, res, &user)) return;
            std::string code, action;
            int qi = 0;
            Db::Set s;
            if (!parseQuestionSubPath(req.path, &code, &qi, &action) || action != "check" ||
                !validCode(code) || !db.getSetByCode(code, &s)) {
              sendJson(res, 404, {{"ok", false}, {"error", "not found"}});
              return;
            }
            if (s.ownerId != user.id && !isAdmin(user)) {
              sendJson(res, 403, {{"ok", false}, {"error", "not your set"}});
              return;
            }
            json questions = parseStored(s.questionsJson);
            if (!questions.is_array() || qi < 0 || qi >= (int)questions.size()) {
              sendJson(res, 404, {{"ok", false}, {"error", "not found"}});
              return;
            }
            json body;
            if (!jsonBody(req, res, kSaveMaxBody, &body)) return;
            if (!body.contains("enabled") || !body["enabled"].is_boolean()) {
              sendJson(res, 400, {{"ok", false}, {"error", "bad enabled"}});
              return;
            }
            bool enabled = body["enabled"].get<bool>();
            if (enabled && (!questions[(size_t)qi].contains("model") ||
                            !questions[(size_t)qi]["model"].is_object())) {
              sendJson(res, 400, {{"ok", false}, {"error", "no model"}});
              return;
            }
            questions[(size_t)qi]["check_enabled"] = enabled;
            if (!db.updateSetQuestions(s.id, questions.dump())) {
              sendJson(res, 500, {{"ok", false}, {"error", "cannot save toggle"}});
              return;
            }
            sendJson(res, 200, {{"ok", true}, {"check_enabled", enabled}});
          });

  auto classItem = [](const Db::Class &c) {
    return json({{"id", c.id},
                 {"code", c.code},
                 {"title", c.title},
                 {"owner", c.ownerName},
                 {"nmembers", c.nmembers},
                 {"nsets", c.nsets},
                 {"created_at", c.createdAt}});
  };
  svr.Post("/api/classes", [&](const httplib::Request &req, httplib::Response &res) {
    Db::User user;
    if (!requireAuth(db, req, res, &user)) return;
    if (!isTeacher(user)) {
      sendJson(res, 403, {{"ok", false}, {"error", "teachers only"}});
      return;
    }
    json body;
    if (!jsonBody(req, res, kSaveMaxBody, &body)) return;
    std::string code = (body.contains("code") && body["code"].is_string())
                           ? trimWs(body["code"].get<std::string>())
                           : "";
    if (!validCode(code)) {
      sendJson(res, 400, {{"ok", false}, {"error", "bad code"}});
      return;
    }
    std::string title = "Untitled class";
    if (body.contains("title")) {
      if (!body["title"].is_string()) {
        sendJson(res, 400, {{"ok", false}, {"error", "invalid title"}});
        return;
      }
      title = trimWs(body["title"].get<std::string>());
      if (title.empty()) title = "Untitled class";
      if (title.size() > 200) title.resize(200);
    }
    long id = db.createClass(user.id, code, title);
    if (id == -2) {
      sendJson(res, 409, {{"ok", false}, {"error", "code taken"}});
      return;
    }
    if (id < 0) {
      sendJson(res, 500, {{"ok", false}, {"error", "cannot save class"}});
      return;
    }
    sendJson(res, 201, {{"ok", true}, {"id", id}, {"code", code}});
  });
  svr.Get("/api/classes", [&](const httplib::Request &req, httplib::Response &res) {
    Db::User user;
    if (!requireAuth(db, req, res, &user)) return;
    std::string scope = isAdmin(user) ? "all" : (isTeacher(user) ? "own" : "joined");
    json arr = json::array();
    for (const Db::Class &c : db.listClasses(scope, user.id)) arr.push_back(classItem(c));
    sendJson(res, 200, {{"ok", true}, {"classes", arr}});
  });
  // One handler per method; the tail selects the sub-action so unknown
  // tails 404 instead of falling through to the static catch-all.
  auto classSub = [&](const httplib::Request &req, httplib::Response &res) {
    Db::User user;
    if (!requireAuth(db, req, res, &user)) return;
    std::string code, tail;
    Db::Class c;
    if (!splitClassPath(req.path, &code, &tail) || !validCode(code) ||
        !db.getClassByCode(code, &c)) {
      sendJson(res, 404, {{"ok", false}, {"error", "not found"}});
      return;
    }
    bool owner = c.ownerId == user.id;
    const std::string &m = req.method;
    if (tail.empty()) {
      if (m == "GET") {
        if (!owner && !isAdmin(user) && !db.isMember(c.id, user.id)) {
          sendJson(res, 403, {{"ok", false}, {"error", "not a member"}});
          return;
        }
        json o = classItem(c);
        o["ok"] = true;
        sendJson(res, 200, o);
        return;
      }
      if (m == "DELETE") {
        if (!owner && !isAdmin(user)) {
          sendJson(res, 403, {{"ok", false}, {"error", "not your class"}});
          return;
        }
        if (!db.deleteClass(c.id, user.id, isAdmin(user))) {
          sendJson(res, 404, {{"ok", false}, {"error", "not found"}});
          return;
        }
        sendJson(res, 200, {{"ok", true}});
        return;
      }
    } else if (tail == "/join" && m == "POST") {
      if (owner || isAdmin(user)) {
        sendJson(res, 400, {{"ok", false}, {"error", "owner cannot join"}});
        return;
      }
      bool joined = false;
      if (!db.joinClass(c.id, user.id, &joined)) {
        sendJson(res, 500, {{"ok", false}, {"error", "cannot join class"}});
        return;
      }
      sendJson(res, 200, {{"ok", true}, {"joined", joined}});
      return;
    } else if (tail == "/leave" && m == "POST") {
      if (owner || isAdmin(user)) {
        sendJson(res, 400, {{"ok", false}, {"error", "owner cannot leave"}});
        return;
      }
      bool left = false;
      if (!db.leaveClass(c.id, user.id, &left)) {
        sendJson(res, 500, {{"ok", false}, {"error", "cannot leave class"}});
        return;
      }
      sendJson(res, 200, {{"ok", true}, {"left", left}});
      return;
    } else if (tail == "/members" && m == "GET") {
      if (!owner && !isAdmin(user)) {
        sendJson(res, 403, {{"ok", false}, {"error", "not your class"}});
        return;
      }
      json arr = json::array();
      for (const Db::Member &mb : db.listMembers(c.id)) {
        arr.push_back({{"username", mb.username},
                       {"name", mb.name},
                       {"joined_at", mb.joinedAt}});
      }
      sendJson(res, 200, {{"ok", true}, {"members", arr}});
      return;
    } else if (tail == "/sets" && m == "GET") {
      if (!owner && !isAdmin(user) && !db.isMember(c.id, user.id)) {
        sendJson(res, 403, {{"ok", false}, {"error", "not a member"}});
        return;
      }
      json arr = json::array();
      for (const Db::Set &s : db.listClassSets(c.id)) arr.push_back(setItem(s));
      sendJson(res, 200, {{"ok", true}, {"sets", arr}});
      return;
    }
    sendJson(res, 404, {{"ok", false}, {"error", "not found"}});
  };
  svr.Get(R"(/api/classes/([^/]+).*)", classSub);
  svr.Post(R"(/api/classes/([^/]+).*)", classSub);
  svr.Delete(R"(/api/classes/([^/]+).*)", classSub);

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
                                             : (exe / ".." / ".." / "public"))
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
