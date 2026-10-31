#include "erp.h"
#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <memory>
#include <regex>
#include <sstream>
#include <vector>
#include <curl/curl.h>

namespace erp {
using nlohmann::json;
namespace {
std::string env(const char *key, const char *fallback = "") {
  const char *value = std::getenv(key);
  return value ? value : fallback;
}
std::string clean(std::string s) {
  auto space = [](unsigned char c) { return std::isspace(c); };
  s.erase(s.begin(), std::find_if_not(s.begin(), s.end(), space));
  s.erase(std::find_if_not(s.rbegin(), s.rend(), space).base(), s.end());
  return s;
}
std::string lower(std::string s) {
  for (char &c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  return s;
}
std::vector<std::string> domains() {
  std::vector<std::string> result;
  std::istringstream input(env("EDUCAD_ERP_EMAIL_DOMAINS", "mit.asia"));
  std::string domain;
  while (std::getline(input, domain, ',')) {
    domain = lower(clean(domain));
    if (!domain.empty() && domain.front() == '@') domain.erase(0, 1);
    if (!domain.empty()) result.push_back(domain);
  }
  return result;
}
struct Response {
  long status = 0;
  std::string body, location;
};
size_t writeBody(char *data, size_t size, size_t count, void *opaque) {
  auto &body = static_cast<Response *>(opaque)->body;
  size_t bytes = size * count;
  if (bytes > 1024 * 1024 || body.size() + bytes > 1024 * 1024) return 0;
  body.append(data, bytes);
  return bytes;
}
size_t writeHeader(char *data, size_t size, size_t count, void *opaque) {
  size_t bytes = size * count;
  std::string line(data, bytes);
  if (lower(line).rfind("location:", 0) == 0)
    static_cast<Response *>(opaque)->location = clean(line.substr(9));
  return bytes;
}
// One cookie engine per sign-in. It never writes a cookie jar to disk.
class Connection {
 public:
  explicit Connection(const std::string &base) : base_(base) {
    static const bool initialized = curl_global_init(CURL_GLOBAL_DEFAULT) == CURLE_OK;
    if (initialized) handle_ = curl_easy_init();
    if (!handle_) return;
    curl_easy_setopt(handle_, CURLOPT_COOKIEFILE, "");
    curl_easy_setopt(handle_, CURLOPT_NOSIGNAL, 1L);
    curl_easy_setopt(handle_, CURLOPT_CONNECTTIMEOUT, 5L);
    curl_easy_setopt(handle_, CURLOPT_TIMEOUT, 20L);
    curl_easy_setopt(handle_, CURLOPT_SSL_VERIFYPEER, 1L);
    curl_easy_setopt(handle_, CURLOPT_SSL_VERIFYHOST, 2L);
    curl_easy_setopt(handle_, CURLOPT_FOLLOWLOCATION, 0L);
    curl_easy_setopt(handle_, CURLOPT_PROTOCOLS_STR, "http,https");
    curl_easy_setopt(handle_, CURLOPT_USERAGENT, "Mozilla/5.0 EduCAD/1.0");
    curl_easy_setopt(handle_, CURLOPT_WRITEFUNCTION, writeBody);
    curl_easy_setopt(handle_, CURLOPT_HEADERFUNCTION, writeHeader);
  }
  ~Connection() { if (handle_) curl_easy_cleanup(handle_); }
  std::string encode(const std::string &value) {
    if (!handle_) return "";
    char *encoded = curl_easy_escape(handle_, value.data(), static_cast<int>(value.size()));
    if (!encoded) return "";
    std::string result(encoded);
    curl_free(encoded);
    return result;
  }
  Response request(const std::string &path, const std::string *form = nullptr) {
    Response response;
    if (!handle_) return response;
    const std::string url = base_ + path;
    const std::string referer = base_ + (form ? "/login.htm" : "/stu_studentDashboard.htm");
    curl_easy_setopt(handle_, CURLOPT_URL, url.c_str());
    curl_easy_setopt(handle_, CURLOPT_REFERER, referer.c_str());
    curl_easy_setopt(handle_, CURLOPT_WRITEDATA, &response);
    curl_easy_setopt(handle_, CURLOPT_HEADERDATA, &response);
    curl_slist *headers = nullptr;
    headers = curl_slist_append(headers, "Accept: application/json, text/javascript, */*; q=0.01");
    headers = curl_slist_append(headers, "X-Requested-With: XMLHttpRequest");
    const std::string origin = "Origin: " + base_;
    headers = curl_slist_append(headers, origin.c_str());
    if (form) {
      headers = curl_slist_append(headers, "Content-Type: application/x-www-form-urlencoded");
      curl_easy_setopt(handle_, CURLOPT_POST, 1L);
      curl_easy_setopt(handle_, CURLOPT_POSTFIELDS, form->data());
      curl_easy_setopt(handle_, CURLOPT_POSTFIELDSIZE, static_cast<long>(form->size()));
    } else {
      curl_easy_setopt(handle_, CURLOPT_HTTPGET, 1L);
    }
    curl_easy_setopt(handle_, CURLOPT_HTTPHEADER, headers);
    CURLcode code = curl_easy_perform(handle_);
    if (code == CURLE_OK) curl_easy_getinfo(handle_, CURLINFO_RESPONSE_CODE, &response.status);
    curl_easy_setopt(handle_, CURLOPT_HTTPHEADER, nullptr);
    curl_slist_free_all(headers);
    return response;
  }
 private:
  CURL *handle_ = nullptr;
  std::string base_;
};
bool unavailable(const Response &r) {
  return r.status == 0 || r.status == 429 || r.status >= 500;
}
json object(const Response &r) {
  if (r.status != 200) return json::object();
  json result = json::parse(r.body, nullptr, false);
  if (result.is_array()) {
    if (result.size() != 1) return json::object();
    result = result[0];
  }
  return result.is_object() ? result : json::object();
}
std::string field(const json &obj, std::initializer_list<const char *> keys) {
  for (const char *key : keys) {
    for (auto it = obj.begin(); it != obj.end(); ++it) {
      if (lower(it.key()) != lower(key)) continue;
      std::string value;
      if (it.value().is_string()) value = clean(it.value().get<std::string>());
      else if (it.value().is_number_integer()) value = it.value().dump();
      if (!value.empty() && value.size() <= 256) return value;
    }
  }
  return "";
}
}
bool demoMode() { return env("EDUCAD_STUDENT_AUTH", "erp") == "demo"; }
json publicConfig() {
  return {{"ok", true}, {"student_auth", demoMode() ? "demo" : "erp"}, {"email_domains", domains()}};
}
Result authenticate(const std::string &email, const std::string &password) {
  Result result;
  static const std::regex emailPattern(R"(^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$)");
  if (email.size() > 254 || !std::regex_match(email, emailPattern) || password.empty() ||
      password.size() > 1024 || password.find('\0') != std::string::npos) {
    result.status = 400;
    result.error = "Enter your college ERP email and password.";
    return result;
  }
  const auto allowed = domains();
  if (!allowed.empty() && std::find(allowed.begin(), allowed.end(), email.substr(email.rfind('@') + 1)) == allowed.end()) {
    result.status = 400;
    result.error = "Use your college ERP email address.";
    return result;
  }
  std::string base = env("EDUCAD_ERP_URL", "https://erp.mit.asia");
  while (!base.empty() && base.back() == '/') base.pop_back();
  // HTTP is supported only for loopback test fixtures. Production always uses TLS.
  static const std::regex origin(R"(^https://[a-zA-Z0-9.-]+(:[0-9]+)?$|^http://(127\.0\.0\.1|localhost)(:[0-9]+)?$)");
  if (!std::regex_match(base, origin)) {
    result.error = "College ERP connection is not configured correctly.";
    return result;
  }
  Connection connection(base);
  std::string form = "j_username=" + connection.encode(email) + "&j_password=" + connection.encode(password);
  Response login = connection.request("/j_spring_security_check", &form);
  std::fill(form.begin(), form.end(), '\0');
  if (unavailable(login)) return result;
  if (login.status == 401 || login.status == 403 ||
      lower(login.location).find("login") != std::string::npos ||
      lower(login.location).find("error") != std::string::npos) {
    result.status = 401;
    result.error = "Invalid college ERP email or password.";
    return result;
  }
  // Follow only same-origin GET redirects, never replaying credentials.
  for (int hop = 0; login.status >= 300 && login.status < 400 && hop < 3; ++hop) {
    std::string path = login.location;
    if (path.rfind(base + "/", 0) == 0) path.erase(0, base.size());
    if (path.empty() || path.front() != '/' || path.rfind("//", 0) == 0 ||
        path.find('\\') != std::string::npos) return result;
    login = connection.request(path);
    if (unavailable(login)) return result;
  }
  Response dashboardResponse = connection.request("/stu_getStudentDashboardDetails.json");
  if (unavailable(dashboardResponse)) return result;
  json dashboard = object(dashboardResponse);
  if (!dashboard.contains("profileDetails") || !dashboard["profileDetails"].is_object() ||
      dashboard["profileDetails"].empty()) {
    result.status = dashboardResponse.status == 401 || dashboardResponse.status == 403 ||
                            (dashboardResponse.status >= 300 && dashboardResponse.status < 400) ||
                            lower(dashboardResponse.body).find("<html") != std::string::npos ? 401 : 502;
    result.error = result.status == 401 ? "Invalid college ERP email or password." :
                                        "ERP did not return a student profile. Please try again later.";
    return result;
  }
  Response personalResponse = connection.request("/stu_getStudentPersonalinfo.json");
  if (unavailable(personalResponse)) return result;
  json personal = object(personalResponse);
  if (personal.empty()) {
    result.status = 502;
    result.error = "ERP could not load your student details. Please try again later.";
    return result;
  }
  json details = dashboard["profileDetails"];
  const std::string returnedEmail = lower(field(details, {"emailId", "email"}));
  if (!returnedEmail.empty() && returnedEmail != email) {
    result.status = 502;
    result.error = "ERP returned a different student account. Please try again later.";
    return result;
  }
  auto read = [&](std::initializer_list<const char *> keys) {
    std::string value = field(details, keys);
    return value.empty() ? field(personal, keys) : value;
  };
  std::string name = read({"fullName", "studentName", "name"});
  if (name.empty()) {
    name = read({"firstName", "fName"});
    for (auto keys : {std::initializer_list<const char *>{"middleName", "mName"},
                     std::initializer_list<const char *>{"lastName", "lName", "surname"}}) {
      const auto part = read(keys);
      if (!part.empty()) name += (name.empty() ? "" : " ") + part;
    }
  }
  if (name.empty()) {
    result.status = 502;
    result.error = "ERP did not return your name. Please try again later.";
    return result;
  }
  result.profile = {{"source", "erp"}, {"email", email}, {"name", name},
                    {"class", read({"className", "studentClass", "standardName", "courseName"})},
                    {"division", read({"divisionName", "division", "divName"})},
                    {"year", read({"yearName", "year", "studyYear", "currentYear"})},
                    {"course", read({"courseName"})},
                    {"roll_no", read({"rollNo", "rollNumber"})},
                    {"student_id", read({"studentId"})}};
  // Live MIT dashboard label: "CS&D Sem VII Div-2". Semester IDs from
  // attendance are unrelated database IDs; only this displayed label is used.
  const std::string course = read({"courseName"});
  static const std::regex label(R"(^(.+?)\s+Sem(?:ester)?\s+([IVX]+|[0-9]+)\s+Div(?:ision)?\s*[-:]?\s*(.+)$)", std::regex::icase);
  std::smatch parts;
  if (std::regex_match(course, parts, label)) {
    if (read({"className", "studentClass", "standardName"}).empty())
      result.profile["class"] = clean(parts[1]);
    if (result.profile["division"] == "") result.profile["division"] = clean(parts[3]);
    const std::vector<std::string> roman = {"i","ii","iii","iv","v","vi","vii","viii"};
    std::string term = lower(parts[2]);
    auto found = std::find(roman.begin(), roman.end(), term);
    int semester = found != roman.end() ? static_cast<int>(found - roman.begin()) + 1 :
                   term.size() == 1 && term[0] >= '1' && term[0] <= '8' ? term[0] - '0' : 0;
    if (semester) {
      result.profile["semester"] = semester;
      if (result.profile["year"] == "") {
        result.profile["year"] = std::to_string((semester + 1) / 2);
        result.profile["year_source"] = "course_semester";
      }
    }
  }
  for (auto &value : result.profile.items()) if (value.value() == "") value.value() = nullptr;
  result.status = 200;
  result.error.clear();
  return result;
}
}
