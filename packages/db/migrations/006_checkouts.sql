CREATE TABLE checkouts (
  store_id      bigint NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  id            bigint NOT NULL,
  token         text   NOT NULL,
  raw           jsonb  NOT NULL,
  contact_email text    GENERATED ALWAYS AS (raw->>'contact_email')          STORED,
  contact_name  text    GENERATED ALWAYS AS (raw->>'contact_name')           STORED,
  contact_phone text    GENERATED ALWAYS AS (raw->>'contact_phone')          STORED,
  total         numeric GENERATED ALWAYS AS (tnt_num(raw->>'total'))         STORED,
  resume_url    text    GENERATED ALWAYS AS (raw->>'abandoned_checkout_url') STORED,
  tn_created_at timestamptz,
  tn_updated_at timestamptz,
  -- Cuando dejó de aparecer en el sync: TN saca el checkout del endpoint
  -- al convertirse, así que esto ES la señal de compra y la supresión.
  gone_at       timestamptz,
  synced_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, id)
);

CREATE INDEX checkouts_live ON checkouts (store_id, tn_updated_at DESC)
  WHERE gone_at IS NULL;

CREATE UNLOGGED TABLE stage_checkouts (
  run_id        bigint NOT NULL,
  store_id      bigint NOT NULL,
  id            bigint NOT NULL,
  token         text   NOT NULL,
  raw           jsonb  NOT NULL,
  tn_created_at timestamptz,
  tn_updated_at timestamptz
);

CREATE INDEX stage_checkouts_by_run ON stage_checkouts (run_id);

-- Conteo de checkouts vistos en la corrida. Vive acá y no en rows_seen porque
-- una corrida de sync cubre productos, variantes y checkouts a la vez: el
-- guardia de la caída sospechosa necesita comparar el conteo de CHECKOUTS
-- contra el de la corrida anterior, y rows_seen ya está ocupado por variantes.
ALTER TABLE sync_runs ADD COLUMN checkouts_seen integer;
