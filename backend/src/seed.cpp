// educad-seed: import tools/users.json into educad.db with hashed passwords.
// Runs once per database; afterwards the server never reads plain-text
// passwords. Usage: educad-seed <users.json> <educad.db>
#include <cstdio>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>

#include "json.hpp"
#include "sqlite3.h"
#include "sodium.h"
#include "schema.h"

namespace fs = std::filesystem;
using nlohmann::json;

int main(int argc, char **argv) {
  if (argc != 3) {
    std::cerr << "usage: educad-seed <users.json> <educad.db>\n";
    return 2;
  }
  if (sodium_init() < 0) {
    std::cerr << "educad-seed: libsodium init failed\n";
    return 1;
  }
  std::ifstream in(argv[1]);
  if (!in) {
    std::cerr << "educad-seed: cannot read " << argv[1] << "\n";
    return 1;
  }
  std::ostringstream ss;
  ss << in.rdbuf();
  json users;
  try {
    users = json::parse(ss.str());
  } catch (const std::exception &e) {
    std::cerr << "educad-seed: invalid json in " << argv[1] << ": " << e.what() << "\n";
    return 1;
  }
  if (!users.is_object()) {
    std::cerr << "educad-seed: top level must be an object\n";
    return 1;
  }
  fs::path dbPath(argv[2]);
  if (dbPath.has_parent_path()) fs::create_directories(dbPath.parent_path());
  sqlite3 *db = nullptr;
  if (sqlite3_open(dbPath.string().c_str(), &db) != SQLITE_OK) {
    std::cerr << "educad-seed: cannot open " << argv[2] << "\n";
    return 1;
  }
  char *err = nullptr;
  if (sqlite3_exec(db, kEducadSchema, nullptr, nullptr, &err) != SQLITE_OK) {
    std::cerr << "educad-seed: schema error: " << (err ? err : "?") << "\n";
    sqlite3_free(err);
    sqlite3_close(db);
    return 1;
  }
  const char *kUpsert =
      "INSERT INTO users(role,username,name,pass_hash,created_at)"
      " VALUES(?1,?2,?3,?4,?5)"
      " ON CONFLICT(role,username) DO UPDATE SET name=excluded.name,"
      " pass_hash=excluded.pass_hash";
  sqlite3_stmt *st = nullptr;
  if (sqlite3_prepare_v2(db, kUpsert, -1, &st, nullptr) != SQLITE_OK) {
    std::cerr << "educad-seed: prepare failed\n";
    sqlite3_close(db);
    return 1;
  }
  const char *kRoles[] = {"academics", "teacher", "student"};
  long now = std::time(nullptr);
  int count = 0;
  for (const char *role : kRoles) {
    if (!users.contains(role) || !users[role].is_array()) continue;
    for (const json &e : users[role]) {
      if (!e.is_object() || !e.contains("username") || !e["username"].is_string() ||
          !e.contains("password") || !e["password"].is_string()) {
        std::cerr << "educad-seed: skipping malformed entry in role " << role << "\n";
        continue;
      }
      std::string username = e["username"].get<std::string>();
      std::string password = e["password"].get<std::string>();
      std::string name = (e.contains("name") && e["name"].is_string())
                             ? e["name"].get<std::string>()
                             : username;
      if (username.empty() || password.empty()) {
        std::cerr << "educad-seed: skipping blank entry in role " << role << "\n";
        continue;
      }
      char hash[crypto_pwhash_STRBYTES];
      if (crypto_pwhash_str(hash, password.c_str(), password.size(),
                            crypto_pwhash_OPSLIMIT_INTERACTIVE,
                            crypto_pwhash_MEMLIMIT_INTERACTIVE) != 0) {
        std::cerr << "educad-seed: out of memory hashing password\n";
        sqlite3_finalize(st);
        sqlite3_close(db);
        return 1;
      }
      sqlite3_reset(st);
      sqlite3_bind_text(st, 1, role, -1, SQLITE_TRANSIENT);
      sqlite3_bind_text(st, 2, username.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_text(st, 3, name.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_text(st, 4, hash, -1, SQLITE_TRANSIENT);
      sqlite3_bind_int64(st, 5, now);
      if (sqlite3_step(st) != SQLITE_DONE) {
        std::cerr << "educad-seed: insert failed for " << role << "/" << username << "\n";
        sqlite3_finalize(st);
        sqlite3_close(db);
        return 1;
      }
      count++;
    }
  }
  sqlite3_finalize(st);
  sqlite3_close(db);
  std::cout << "educad-seed: " << count << " users -> " << argv[2] << "\n";
  return 0;
}
