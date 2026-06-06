# ADMS

Express + TypeScript REST API: PostgreSQL və MongoDB ilə **dual storage**, əvvəlki oxuma müddətlərinə əsaslanan **DecisionEngine**, yazmalarda **primary + background mirror**, oxumada **race** və ya tək DB rejimi, **repository metrikaları**, **HTTP sorğu metrikaları** və **Swagger UI**.

**Redis** eyni anda: sağlamlıq yoxlaması, **metrika saxlama** (`ADMS:metrics:repo`, `ADMS:metrics:http` — LPUSH + LTRIM), və **Socket.IO** ilə admin panelə real-time göndərmə üçün istifadə olunur.

---

## Tələblər

- [Node.js](https://nodejs.org/) 22+ (lokal inkişaf üçün)
- [Docker](https://www.docker.com/) və Docker Compose

---

## Layihə strukturu

```
ADMS-main/
├── app/
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                 # Express, middleware sırası, OpenAPI birləşməsi
│       ├── config/env.ts            # Bütün mühit dəyişənləri
│       ├── domain/post.ts           # Post entity və input tipləri
│       ├── adapters/              # Raw bağlantılar: postgres (pg Pool), mongo, redis
│       ├── repositories/
│       │   ├── types.ts             # PostRepository, ReadStrategy, BasePostRepository
│       │   ├── decision-engine.ts # Əvvəlki metrikalara əsasən primary DB seçimi
│       │   ├── post.repository.ts # SmartPostRepository (əsas məntiq)
│       │   └── base/
│       │       ├── postgres-post.repository.ts   # Yalnız SQL CRUD
│       │       └── mongo-post.repository.ts      # Yalnız Mongo CRUD
│       ├── services/post.service.ts   # DB-agnostic servis (yalnız interfeys)
│       ├── routes/
│       │   ├── posts.routes.ts        # CRUD + openApiPaths/openApiSchemas export
│       │   ├── metrics.routes.ts      # Metrika API + Swagger export
│       │   ├── health.routes.ts       # /health + Swagger export
│       │   └── root.routes.ts         # / + Swagger export
│       └── metrics/
│           ├── repository-metrics.ts  # Memory + Redis persist, async summary
│           ├── redis-metrics-store.ts # Redis LIST metrikaları
│           ├── aggregate.ts           # Orta hesablar
│           ├── request-context.ts     # AsyncLocalStorage
│           └── request-metrics.middleware.ts
│       └── realtime/metrics-socket.ts # Socket.IO
├── admin/                 # Vite + React analitika paneli (Docker: nginx)
├── docker-compose.yml
└── README.md
```

---

## Arxitektura (necə qurulub)

```text
HTTP  →  requestMetricsMiddleware (AsyncLocalStorage)
      →  Router (posts / metrics / health / root)
      →  PostService (heç bir DB adı bilmir)
      →  SmartPostRepository
              ├── DecisionEngine  ← MetricsRecorder-dakı son əməliyyatlar
              ├── PostgresPostRepository (dumb CRUD)
              └── MongoPostRepository (dumb CRUD)
```

- **Service** yalnız `PostRepository` interfeysini çağırır; PostgreSQL/MongoDB və ya qərar məntiqi service-də yoxdur.
- **Base repos** ("dumb") yalnız bir DB ilə danışır: `insert`, `findById`, `findAll`, `update`, `delete`.
- **SmartPostRepository** bütün ikiqat yazma, oxuma strategiyası və metrika yazılmasını idarə edir.
- **Post ID** server tərəfində `crypto.randomUUID()` ilə verilir; eyni `id` hər iki DB-də istifadə olunur ki, müqayisə və sinxron saxlanılsın.

OpenAPI təsviri hər route faylında `openApiPaths` / `openApiTags` (və posts üçün `openApiSchemas`) kimi export olunur; [app/src/index.ts](app/src/index.ts) bunları birləşdirir və Swagger UI təqdim edir.

---

## Funksionallıq (necə işləyir)

### Yazma (create, update, delete)

1. **DecisionEngine** həmin əməliyyat növü üçün (`create`, `findById`, …) sonuncu metrikalar əsasında **primary** DB seçir (PostgreSQL və ya MongoDB).
2. Hər iki DB-yə eyni anda sorğu başladılır (eyni payload / eyni `id`).
3. Cavab **primary** tamamlananda** qaytarılır; digər tərəf adətən arxa fonda tamamlanır (mirror).
4. Primary uğursuz olarsa, **mirror** üzrə sinxron gözləmə ilə fallback edilir; hər ikisi uğursuzdursa xəta atılır.
5. Hər iki tərəf tamamlananda `MetricsRecorder.record()` çağırılır: `postgresMs`, `mongoMs`, `selectedDb` (primary), `partialFailure`.

### Oxuma (findById, findAll)

`READ_STRATEGY` mühit dəyişəni ilə idarə olunur:

| Dəyər | Davranış |
|--------|-----------|
| `race` (default) | Hər iki DB-dən paralel; `Promise.any` ilə birinci uğurlu cavab qaytarılır; hər iki müddət metrikaya yazılır. |
| `postgres` | Yalnız PostgreSQL. |
| `mongo` | Yalnız MongoDB. |
| `decision` | DecisionEngine həmin oxuma əməliyyatı üçün bir DB seçir, yalnız ora sorğu gedir. |

### DecisionEngine (cold start və statistika)

- Son `DECISION_SAMPLE_SIZE` (default 50) repo metrikasından həmin `op` üçün uğurlu PostgreSQL və MongoDB müddətlərinin ortalaması hesablanır.
- Ümumi repo record sayı `DECISION_MIN_SAMPLES` (default 3)-dən azdırsa → `DECISION_DEFAULT_DB` (default `postgres`) istifadə olunur.
- Bir tərəfdə ardıcıl uğursuzluq varsa, mövcud tərəf müvəqqəti istisna olunub digər tərəf seçilə bilər.

Detallı izah üçün: `GET /api/metrics/decision`.

### Metrikalar

**Repository səviyyəsi** (hər smart repo əməliyyatı):

- Ring buffer (default ölçü `METRICS_BUFFER_SIZE`, məs. 500).
- `GET /api/metrics/summary` — əməliyyat növü üzrə orta ms, qalib sayları, uğursuzluqlar.
- `GET /api/metrics/recent?limit=N` — son qeydlər.

**HTTP sorğu səviyyəsi** (hər cavabda ümumi müddət və DB üzrə toplamlar):

- Middleware `AsyncLocalStorage` ilə request başına PostgreSQL və MongoDB üzrə toplanmış ms, əməliyyat sayı və son seçilmiş DB-ni izləyir.
- Cavab header-ləri (CORS `exposedHeaders` ilə açıqdır): `X-Request-Id`, `X-Postgres-Ms`, `X-Mongo-Ms`, `X-Op-Count`, `X-Selected-Db`, lazım olsa `X-Partial-Failures`.
- `GET /api/metrics/http/summary` — route pattern üzrə (məs. `GET /api/posts/:id`) aggregate.
- `GET /api/metrics/http/recent?limit=N` — son HTTP qeydləri.
- `GET /api/metrics/source` — cavab `redis` və ya `memory`: ortalamalar haradan gəlir.

**Redis-də saxlama (persist):** Hər repo/HTTP metrikası JSON sətri kimi `LPUSH` edilir, siyahı `LTRIM` ilə `METRICS_REDIS_MAX_ENTRIES` (default 5000) ilə limitlənir. `METRICS_USE_REDIS=true` olduqda yazılır; `METRICS_QUERY_FROM_REDIS=true` olduqda `summary` / `recent` / `decision` hesablamaları bu siyahılardan gəlir (proses restart olsa belə). Yaddaş buffer hələ də eyni proses daxilində sürətli fallback və `AsyncLocalStorage` üçündür.

**Real-time (Socket.IO):** `record` / `http` hadisələri `repo:metric` və `http:metric` adlı event-lərlə bütün qoşulu client-lərə yayımlanır. Path: `/socket.io` (eyni HTTP server).

**Admin panel (`admin/`):** React + Recharts. **Lokal:** `cd admin && npm install && npm run dev` → `http://localhost:5174` (Vite API-ni `3001`-ə proxy edir). **Docker:** xidmət `admin`, default `http://localhost:8080` — nginx statik faylları verir və `/api/` ilə `/socket.io/`-nu API konteynerinə proksi edir (`ADMIN_HOST_PORT` ilə dəyişən).

---

## Tez başlanğıc (Docker)

Layihə kökündən:

```bash
docker compose up -d --build
```

- API (default host port): `http://localhost:3001`
- Swagger UI: `http://localhost:3001/api-docs`
- Admin analitika paneli (default): `http://localhost:8080`

Host-da **3001** təyin olunub ki, 3000 tez-tez məşğul olmasın. Dəyişmək: kökdə `.env` və ya `API_HOST_PORT`.

Verilənlər bazası konteynerləri healthcheck-dən keçəndən sonra API qalxır.

---

## Lokal inkişaf (API TS, DB Dockerdə)

```bash
docker compose up -d postgres mongo redis
cd app
npm install
npm run dev
```

Default əlaqələr `app/src/config/env.ts`-də localhost portları ilə uyğunlaşır.

Admin UI (API artıq işləyəndə): ikinci terminalda `cd admin && npm run dev`.

---

## Skriptlər (`app/`)

| Əmr | Təsvir |
|-----|--------|
| `npm run dev` | `tsx watch` ilə inkişaf serveri |
| `npm run build` | `tsc` → `dist/` |
| `npm start` | `node dist/index.js` (əvvəl `build`) |

---

## Mühit dəyişənləri

| Dəyişən | Təsvir | Default |
|---------|--------|---------|
| `PORT` | Konteyner içi dinləmə portu | `3000` |
| `PUBLIC_URL` | Swagger üçün server URL (sonunda `/` olmasın) | `http://localhost:<PORT>` |
| `DATABASE_URL` | PostgreSQL connection string | `postgres://ADMS:ADMS@localhost:5432/ADMS` |
| `MONGODB_URI` | MongoDB URI | `mongodb://localhost:27017/ADMS` |
| `REDIS_URL` | Redis URI | `redis://localhost:6379` |
| `READ_STRATEGY` | Oxuma: `race` \| `postgres` \| `mongo` \| `decision` | `race` |
| `METRICS_BUFFER_SIZE` | Repo + HTTP ring buffer ölçüsü (proses yaddaşı) | `500` |
| `METRICS_USE_REDIS` | Repo/HTTP metrikalarını Redis LIST-ə yaz | `true` |
| `METRICS_QUERY_FROM_REDIS` | Summary/recent/decision ortalamalarını Redis-dən oxu | `true` |
| `METRICS_REDIS_MAX_ENTRIES` | Hər Redis list üçün max element sayı | `5000` |
| `CORS_ORIGINS` | Vergüllə ayrılmış origin-lər (Socket.IO + HTTP üçün) | localhost 5173–5174 + admin port |
| `DECISION_DEFAULT_DB` | Kifayət qədər sample olmayanda primary | `postgres` |
| `DECISION_SAMPLE_SIZE` | Decision üçün son neçə repo record-a baxılsın | `50` |
| `DECISION_MIN_SAMPLES` | Bu qədər ümumi repo record olmadan default DB | `3` |

Docker Compose-da API üçün: `READ_STRATEGY`, metrika Redis bayraqları və `CORS_ORIGINS` (admin üçün `ADMIN_HOST_PORT` daxil olmaqla) nümunə kimi verilir.

Host portları (konflikt zamanı): `API_HOST_PORT`, `POSTGRES_HOST_PORT`, `MONGO_HOST_PORT`, `REDIS_HOST_PORT`, `ADMIN_HOST_PORT` (admin UI, default 8080).

---

## HTTP endpointlər

| Metod | Yol | Qısa təsvir |
|--------|-----|----------------|
| GET | `/` | API mesajı + docs linki |
| GET | `/health` | Adapter ping (postgres, mongo, redis) + `readStrategy` |
| GET | `/api-docs` | Swagger UI |
| POST | `/api/posts` | Post yarat (primary+mirror yazma) |
| GET | `/api/posts` | Siyahı (`limit`, `offset`) |
| GET | `/api/posts/:id` | Tək post |
| PATCH | `/api/posts/:id` | Yenilə |
| DELETE | `/api/posts/:id` | Sil |
| GET | `/api/metrics/summary` | Repo əməliyyatı üzrə aggregate |
| GET | `/api/metrics/recent` | Son repo metrikaları |
| GET | `/api/metrics/http/summary` | Route üzrə HTTP aggregate |
| GET | `/api/metrics/http/recent` | Son HTTP sorğu metrikaları |
| GET | `/api/metrics/decision` | DecisionEngine izahı (hər `op` üçün) |
| GET | `/api/metrics/source` | `redis` \| `memory` — ortalamaların mənbəyi |

CORS: `CORS_ORIGINS` ilə idarə olunur (default Vite + lokal admin portları). Header-lərə brauzerdən giriş üçün `exposedHeaders` açıqdır.

---

## Təhlükəsizlik qeydi

Compose-dakı default PostgreSQL istifadəçi/parol (`ADMS`) yalnız inkişaf üçündür. İstehsalda güclü parollar, şəbəkə məhdudiyyətləri və sir idarəetməsi tələb olunur.

---

## Faydalı əmrlər

```bash
docker compose logs -f api
docker compose down
docker compose down -v   # volumeları da silir (DB məlumatı itər)
```
