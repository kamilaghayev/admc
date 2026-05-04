# ADMS — k6 yük testləri

Bu qovluq Adaptive Data Management System (ADMS) API-si üçün suni yük testlərini saxlayır. Testlər iki rejimdə işləyə bilər: **lokal** (host-da quraşdırılmış k6) və **Docker Compose** profili.

## Quruluş

```
loadtests/
├── lib/
│   ├── auth.js              # login / refresh / logout / authHeaders helper-ləri
│   └── random.js            # random title/content/tags/update generator
├── scenarios/
│   ├── posts-mixed.js       # qarışıq CRUD (~50% list, ~25% get, ~17% create, ~8% patch)
│   ├── auth-flow.js         # login → me → metrics → refresh rotation → logout
│   └── decision-warmup.js   # engine isidir, sonda /api/metrics/decision/accuracy oxuyur
├── options.json             # nümunə default options
└── README.md
```

## Tələblər

- API ayağa qaldırılmış olmalıdır (default: `http://localhost:3001`).
  - Docker rejimində avtomatik `http://api:3000` ünvanı istifadə olunur.
- `decision-warmup.js` və `auth-flow.js` skriptləri admin login tələb edir (`ADMIN_USERNAME` / `ADMIN_PASSWORD`).

## Admin panelindən işə salma

Admin kimi daxil ol (`/admin`) → analitika səhifəsində **k6 yük testləri** paneli bölməsində ssenari seçib **Testi başlat** düyməsini sıxırıq.

- Əməliyyat üçün **access token lazımdır**; gözləmə müddəti bir neçə dəqiqəyə çıxa bilər (brauzer səhifəsini bağlama).
- Konteynerdə API özünə məhdud URL işlədir (`LOAD_TEST_BASE_URL`, default Docker-də `http://127.0.0.1:3000` — əvvəlki kimi eyni qabda `k6`).
- Əgər cavab `"k6 icra olunmadı"` isə host-da Docker image-i yenidən qur (`docker compose build api`) və ya lokal üçün [k6](https://k6.io/) quraşdır.

Server tərəfi ən əsası: `POST /api/load-tests/run`, `GET /api/load-tests/scenarios` (Swagger: `/api-docs`).

Hər uğurlu/səhv işləmədən sonra (k6 bitəndə) sistem **bir JSON faylı** yazır: `DISPLAY_NAME` sırası `TEST1`, `TEST2`, … üstəlik təsadüfi `#TAG` ilə fərqlənir. Faylda həm tam `k6` çıxışı (summary, stdout/stderr), həm də həmin anın **PostgreSQL/Mongo repository metrikleri**, HTTP route aqreqatları və **DecisionEngine / accuracy snapshot** düşür. Default qovluq: `LOAD_TEST_RESULTS_DIR` (Docker: `/app/data/load-test-results`). Admin paneldə **Saxlanmış testlər** bölməsində faylı seçərkən diaqramlar və tam JSON görünür, **JSON yüklə** ilə brauzerdən çıxarırsan.

## Environment dəyişənləri

| Dəyişən              | Default                  | Açıqlama                                        |
| -------------------- | ------------------------ | ----------------------------------------------- |
| `BASE_URL`           | `http://localhost:3001`  | API baza URL-i                                  |
| `ADMIN_USERNAME`     | `admin`                  | Admin login                                     |
| `ADMIN_PASSWORD`     | `admin`                  | Admin parol                                     |
| `ACCURACY_THRESHOLD` | `60`                     | DecisionEngine düzgünlüyü minimum faiz (PASS)   |
| `VUS`, `VUS_LOW`, `VUS_HIGH` | 5/10/50           | Virtual istifadəçi sayı                         |
| `DURATION`, `RAMP_*`, `HOLD_*` | —              | Stage müddətləri (k6 sintaksisi: `30s`, `1m`)   |
| `SEED_COUNT`         | 30–50                    | Setup vaxtı yaradılan post sayı                 |

API (UI runner üçün əlavə):

| Dəyişən               | Default                     | Açıqlama                                              |
| --------------------- | --------------------------- | ----------------------------------------------------- |
| `LOAD_TEST_BASE_URL`  | `http://127.0.0.1:<PORT>`   | Konteyner daxili k6 hansı əsas URL-a vuracaq           |
| `LOAD_TEST_MAX_MS`    | `660000`                    | k6 proses üçün maks. müddət (ms), sonra SIGKILL       |
| `K6_BINARY`           | `k6`                        | icra olunacaq ikili yol/adı                           |
| `LOADTESTS_DIR`       | (avtomatik tapılır)         | `loadtests` qovluğunun dəqiq yolu                     |

## Lokal icra (host-da k6)

k6 quraşdırılması: <https://k6.io/docs/get-started/installation/>.

```bash
# Qarışıq CRUD yükü
k6 run loadtests/scenarios/posts-mixed.js

# Daha aqressiv konfiqurasiya
k6 run -e VUS_LOW=20 -e VUS_HIGH=100 loadtests/scenarios/posts-mixed.js

# Auth axını + refresh rotation
k6 run -e BASE_URL=http://localhost:3001 loadtests/scenarios/auth-flow.js

# DecisionEngine warmup + accuracy threshold
k6 run -e ACCURACY_THRESHOLD=70 loadtests/scenarios/decision-warmup.js
```

## Docker Compose icra (`load` profile)

`docker-compose.yml`-də `k6` adlı service `profiles: ["load"]` ilə qeydiyyatdan keçir, beləliklə adi `docker compose up` zamanı ayağa qalxmır. Skriptlər image-ə volume olaraq mount olunur.

```bash
# API + DB stack ayağa qalxır (admin daxil)
docker compose up -d

# Posts mixed
docker compose --profile load run --rm k6 run /scripts/scenarios/posts-mixed.js

# Auth flow
docker compose --profile load run --rm k6 run /scripts/scenarios/auth-flow.js

# Decision warmup + accuracy (threshold env-dən)
ACCURACY_THRESHOLD=70 \
  docker compose --profile load run --rm k6 run /scripts/scenarios/decision-warmup.js
```

> Docker rejimində `BASE_URL=http://api:3000` avtomatik təyin olunur (API container daxili portu).

## NFR thresholdları

`posts-mixed.js`:
- `http_req_failed < 2%`
- `http_req_duration p(95) < 500ms` (list/get üçün < 400ms)

`auth-flow.js`:
- `http_req_failed < 1%`
- `auth_login p(95) < 400ms`, `auth_refresh p(95) < 300ms`
- `rotated_refresh_total > 0` (rotation faktiki olaraq baş verməlidir)

`decision-warmup.js`:
- `http_req_failed < 2%`
- `decision_accuracy_pct >= ACCURACY_THRESHOLD`
- `decision_evaluated_ops >= 1` (ən azı bir op qiymətləndirilməlidir)

## DecisionEngine düzgünlüyü necə hesablanır

Server tərəfində `GET /api/metrics/decision/accuracy`:
1. Hər `RepoOp` üçün `DecisionEngine.explain(op)` çağırılır → engine seçimi + ortalamalar.
2. Hər iki DB-də sample varsa, faktiki sürətli DB hesablanır (`pgAvg <= mgAvg ? postgres : mongo`).
3. `correct = selected === fasterDb`. Sample yoxdursa `correct = null` (qiymətləndirilmir).
4. `overall.accuracyPct` = düzgün/qiymətləndirilən * 100.

`decision-warmup.js` test-in sonunda (`teardown`) bu endpoint-i çağırır, hər op üçün konsola sətr yazır və `accuracyPct` `Gauge` metric-i kimi qeyd edir.

## Tipik istifadə ssenarisi

1. `docker compose up -d` ilə stack-i ayağa qaldır.
2. `docker compose --profile load run --rm k6 run /scripts/scenarios/decision-warmup.js`.
3. Eyni vaxtda admin panel açıq saxla (`http://localhost:8080/admin`) — KPI kartları və DecisionEngine paneli yenilənərkən real vaxtda dəyişir.
4. Threshold çatdırılmırsa: `DECISION_MIN_SAMPLES`, `DECISION_SAMPLE_SIZE` və `READ_STRATEGY=decision` env dəyişənlərini API tərəfində korrektə et.
