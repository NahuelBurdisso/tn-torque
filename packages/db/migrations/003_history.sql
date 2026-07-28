-- Se escribe UNA fila por cambio real, no por corrida de sync.
-- El backfill escribe una fila baseline por variante: sin ella el segundo
-- sync no tiene contra qué comparar y leería todo el catálogo como cambio.
CREATE TABLE variant_snapshots (
  id          bigserial PRIMARY KEY,
  store_id    bigint NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  variant_id  bigint NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  price       numeric,
  promo_price numeric,
  stock       integer
);

CREATE INDEX variant_snapshots_latest
  ON variant_snapshots (store_id, variant_id, observed_at DESC);

CREATE TABLE sync_runs (
  id             bigserial PRIMARY KEY,
  store_id       bigint NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  resource       text NOT NULL,
  mode           text NOT NULL CHECK (mode IN ('backfill','incremental','reconcile')),
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz,
  rows_seen      integer NOT NULL DEFAULT 0,
  rows_changed   integer NOT NULL DEFAULT 0,
  events_emitted integer NOT NULL DEFAULT 0,
  error          text
);

CREATE INDEX sync_runs_by_store ON sync_runs (store_id, resource, started_at DESC);

-- Staging: UNLOGGED porque es descartable y así no paga WAL.
CREATE UNLOGGED TABLE stage_variants (
  run_id        bigint  NOT NULL,
  store_id      bigint  NOT NULL,
  id            bigint  NOT NULL,
  product_id    bigint  NOT NULL,
  raw           jsonb   NOT NULL,
  stock         integer,
  tn_updated_at timestamptz
);

CREATE INDEX stage_variants_by_run ON stage_variants (run_id);

CREATE UNLOGGED TABLE stage_products (
  run_id        bigint NOT NULL,
  store_id      bigint NOT NULL,
  id            bigint NOT NULL,
  raw           jsonb  NOT NULL,
  tn_updated_at timestamptz
);

CREATE INDEX stage_products_by_run ON stage_products (run_id);
