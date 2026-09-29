-- EduCAD C++ backend schema. Single source of truth; embedded into the
-- binaries at build time (see CMakeLists.txt -> schema.h). The database file
-- itself lives outside the served root (see EDUCAD_DB in main.cpp).
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL CHECK (role IN ('academics','teacher','student')),
  username TEXT NOT NULL,
  name TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (role, username)
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS drawings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Untitled',
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_drawings_user ON drawings(user_id);
CREATE TABLE IF NOT EXISTS progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson TEXT NOT NULL,
  state_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, lesson)
);
CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL DEFAULT 'Untitled class',
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS class_members (
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (class_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_class_members_user ON class_members(user_id);
CREATE TABLE IF NOT EXISTS sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL DEFAULT 'Untitled set',
  questions_json TEXT NOT NULL DEFAULT '[]',
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  set_id INTEGER NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_index INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  verdict TEXT NOT NULL DEFAULT '',
  remarks TEXT NOT NULL DEFAULT '',
  auto_pass INTEGER DEFAULT NULL,
  auto_score REAL DEFAULT NULL,
  auto_details TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_submissions_set ON submissions(set_id);
CREATE INDEX IF NOT EXISTS idx_submissions_user ON submissions(user_id);
