# MIT college ERP student login

Students use their `@mit.asia` ERP email and password on both the original
login page and Major 2. Staff retain their existing local login. Guest mode
still opens an unsaved drawing workspace.

The integration follows [MIT_Attendance](https://github.com/makrand999/MIT_Attendance)
at commit `2d0a7d553f23744b1ac95a840de058e7567c8c62`, particularly
`AttendanceApiService.kt` and `model/Models.kt`.

## Verification and profile mapping

1. `POST /api/login` accepts `{role:"student", email, password}`. The existing
   `username` key also accepts the ERP email for older clients.
2. The server checks the email domain, then posts a URL-encoded
   `j_username` / `j_password` form to
   `https://erp.mit.asia/j_spring_security_check` using verified TLS.
3. Each attempt has an independent, in-memory cookie engine. Only same-origin
   GET redirects are followed. A redirect or cookie alone does not prove login.
4. The protected `stu_getStudentDashboardDetails.json` must return a nonempty
   `profileDetails` object. `stu_getStudentPersonalinfo.json` supplies additional
   student fields. A returned email must match the submitted account.
5. Only a normalized student identity is saved, and a 24-hour lab session is
   issued. Subsequent ERP sign-ins update the same account by normalized email,
   preserving drawings, submissions, and class memberships.

| Lab field | ERP source |
|---|---|
| Name | Full name if supplied; otherwise first + middle + last name |
| Class | Explicit class field; otherwise program in `courseName` |
| Division | Explicit division field; otherwise division in `courseName` |
| Year | Explicit study year; otherwise two-semester study year from the displayed course semester |
| Course | Original dashboard `courseName` label |
| Roll number | `rollNo` |
| Student ID | Personal profile `studentId` |

A live account check confirmed the dashboard label `CS&D Sem VII Div-2`.
This maps to class `CS&D`, division `2`, semester `7`, and study year `4`.
The year is a derived study year, not the academic calendar year;
`year_source:"course_semester"` records that distinction. Roman and numeric
semester labels I–VIII / 1–8 are supported. Unknown formats retain the original
course label and leave missing fields null. The account panel displays
“Not provided by ERP” for missing fields. Numeric attendance term IDs and
admission dates are never used to guess year.

The database stores the normalized profile in `student_profiles`, automatically
created for new and existing databases. ERP-created users have an empty local
password hash. Neither the ERP password, ERP cookie, raw profile response,
contact number, government ID, nor other unrelated personal fields are saved.
Only the lab session and normalized profile are sent to the browser.
Students cannot supply their own trusted name, class, division, or year.

## Run and deploy

Install the additional C++ HTTP dependency on the deployment host:

```sh
sudo apt-get install -y cmake g++ libsodium-dev libcurl4-openssl-dev
npm start
```

Defaults work for MIT without extra environment settings:

| Variable | Default | Purpose |
|---|---|---|
| `EDUCAD_STUDENT_AUTH` | `erp` | Set `demo` only for local demo/student test accounts |
| `EDUCAD_ERP_URL` | `https://erp.mit.asia` | Server-controlled ERP origin; production requires HTTPS |
| `EDUCAD_ERP_EMAIL_DOMAINS` | `mit.asia` | Comma-separated exact allowed email domains |

Serve the college deployment over HTTPS. The existing `/major/api/` and
`/major2/api/` proxy routes forward login/config/profile requests to the C++
backend; no browser-to-ERP proxy or ERP cookies are needed in the browser.
Keep request bodies out of reverse-proxy access logs.

An ERP outage, invalid credentials, unavailable profile, or unsupported
response creates no account or session. Local student passwords never serve
as a fallback in ERP mode. Existing local demo student sessions are rejected
in ERP mode. Local test fixtures explicitly set demo mode and require no real
college credentials. Staff account provisioning remains the existing mechanism.

`GET /api/auth/config` exposes only student login mode and allowed email domains,
so both login pages can show appropriate fields. `GET /api/me` returns the
saved normalized profile under `profile`, including updates from later sign-ins.

## Validation

```sh
npm run test:erp
npm run test:erp-browser  # optional cached Chromium or MAJOR2_CHROMIUM
npm run test:login
npm run test:lab
npm run test:cpp
```

The ERP suite uses disposable databases and a local fixture. It covers form
encoding, domain validation, live-shaped profile mapping, synchronization and
account reuse, saved drawings, logout, concurrent cookie isolation, missing
or malformed profiles, ERP outages, cross-origin redirects, TLS certificate
verification, staff access, and demo/ERP separation. It verifies that passwords,
ERP cookies, and unrelated personal details do not appear in database files.
