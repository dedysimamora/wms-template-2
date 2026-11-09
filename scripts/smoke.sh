#!/usr/bin/env bash
# Smoke test HTTP: auth + session + RBAC (admin vs staff) terhadap server yang SEDANG berjalan.
# DB harus hasil seed segar (skrip mengganti password admin & staff):  pnpm db:reset
# Pakai: BASE=http://localhost:3000 bash scripts/smoke.sh
# Catatan: di build production (`pnpm build` + server.js) lewat http://localhost, set COOKIE_SECURE=false.
set -uo pipefail
B=${BASE:-http://localhost:3000}
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
pass=0; fail=0
csrf() { awk '$6=="csrf_token"{print $7}' "$T/$1" 2>/dev/null; }
# call <jar> <METHOD> <path> [json] [csrf:yes|no]
call() {
  local jar=$1 m=$2 p=$3 d=${4:-} c=${5:-yes}
  local args=(-s -o "$T/body" -w '%{http_code}' -b "$T/$jar" -c "$T/$jar" -X "$m" "$B$p" -H "origin: $B" -H 'content-type: application/json')
  [[ $c == yes && $m != GET ]] && args+=(-H "x-csrf-token: $(csrf "$jar")")
  [[ -n $d ]] && args+=(-d "$d")
  curl "${args[@]}"
}
page() { curl -s -o "$T/body" -w '%{http_code}' -b "$T/$1" "$B$2"; }
check() { # <nama> <status aktual> <status harapan> [pola body]
  local ok=1; [[ $2 == "$3" ]] || ok=0
  [[ -n ${4:-} ]] && ! grep -q "$4" "$T/body" && ok=0
  if ((ok)); then pass=$((pass+1)); echo "PASS  $1"; else fail=$((fail+1)); echo "FAIL  $1 — status $2 (harap $3) $(head -c 200 "$T/body")"; fi
}
# login + ganti password wajib + login ulang → jar siap pakai
onboard() { # <jar> <username> <password baru>
  # JSON disusun di variabel dulu: di dalam $(...) bash akan memecah {a,b} (brace expansion).
  local seed new change
  seed=$(printf '{"username":"%s","password":"ChangeMe123!"}' "$2")
  new=$(printf '{"username":"%s","password":"%s"}' "$2" "$3")
  change=$(printf '{"current_password":"ChangeMe123!","new_password":"%s"}' "$3")
  check "$2: login seed" "$(call "$1" POST /api/v1/auth/login "$seed" no)" 200 '"must_change_password":true'
  check "$2: API diblok sebelum ganti password" "$(call "$1" GET /api/v1/sample/items)" 403 'MUST_CHANGE_PASSWORD'
  check "$2: ganti password" "$(call "$1" POST /api/v1/auth/change-password "$change")" 200
  check "$2: login password baru" "$(call "$1" POST /api/v1/auth/login "$new" no)" 200 '"must_change_password":false'
}

check 'health'                    "$(curl -s -o "$T/body" -w '%{http_code}' "$B/api/health")" 200 '"ok"'
check 'ready (schema dalam rentang)' "$(curl -s -o "$T/body" -w '%{http_code}' "$B/api/ready")" 200 '"ready"'
LOC=$(curl -s -o /dev/null -D - -H 'host: wms.contoh.test' "$B/api/v1/auth/refresh?next=%2F" | tr -d '\r' | awk 'tolower($1)=="location:"{print $2}')
check "refresh tanpa sesi → Location relatif ($LOC)" "$LOC" '/login?next=%2F'
check 'password salah → 401'      "$(call x POST /api/v1/auth/login '{"username":"admin","password":"salah"}' no)" 401 'INVALID_CREDENTIALS'
check 'origin asing ditolak (CSRF)' "$(curl -s -o "$T/body" -w '%{http_code}' -X POST "$B/api/v1/auth/login" -H 'origin: http://jahat.test' -H 'content-type: application/json' -d '{}')" 403 'CSRF'

# ── admin ──
onboard a admin 'AdminSmoke2026'
check 'admin: password lemah ditolak' "$(call a POST /api/v1/auth/change-password '{"current_password":"AdminSmoke2026","new_password":"pendek"}')" 400 'VALIDATION_ERROR'
check 'admin: create item'        "$(call a POST /api/v1/sample/items '{"code":"SMOKE-1","name":"Smoke"}')" 201 '"code":"SMOKE-1"'
ID=$(grep -o '"id":"[^"]*"' "$T/body" | head -1 | cut -d'"' -f4)
check 'admin: kode duplikat → 409' "$(call a POST /api/v1/sample/items '{"code":"SMOKE-1","name":"Lagi"}')" 409 'CODE_TAKEN'
check 'admin: payload invalid → 400' "$(call a POST /api/v1/sample/items '{"code":""}')" 400 'VALIDATION_ERROR'
check 'admin: list + cari'        "$(call a GET '/api/v1/sample/items?q=smoke')" 200 '"total":1'
check 'admin: patch'              "$(call a PATCH "/api/v1/sample/items/$ID" '{"name":"Smoke 2"}')" 200 'Smoke 2'
check 'admin: daftar user'        "$(call a GET /api/v1/admin/users)" 200 '"username":"staff"'
check 'admin: halaman Users'      "$(page a /admin/users)" 200
check 'admin: rute asing → 404'   "$(page a /rahasia/x)" 404
check 'refresh (rotasi) + CSRF'   "$(call a POST /api/v1/auth/refresh '')" 200

# ── staff ──
onboard s staff 'StaffSmoke2026'
check 'staff: list item'          "$(call s GET /api/v1/sample/items)" 200 '"SMOKE-1"'
check 'staff: edit item'          "$(call s PATCH "/api/v1/sample/items/$ID" '{"status":"INACTIVE"}')" 200 '"INACTIVE"'
check 'staff: hapus item → 403'   "$(call s DELETE "/api/v1/sample/items/$ID")" 403 'FORBIDDEN'
check 'staff: API users → 403'    "$(call s GET /api/v1/admin/users)" 403 'FORBIDDEN'
check 'staff: halaman Users → /forbidden' "$(curl -s -o /dev/null -w '%{http_code}' -b "$T/s" "$B/admin/users")" 307
check 'staff: halaman Sample Items' "$(page s /sample/items)" 200

check 'admin: hapus item'         "$(call a DELETE "/api/v1/sample/items/$ID")" 200 '"deleted":true'
check 'logout'                    "$(call a POST /api/v1/auth/logout '')" 200
check 'setelah logout → 401'      "$(call a GET /api/v1/auth/me)" 401

echo "── smoke: $pass PASS, $fail FAIL"
((fail == 0))
