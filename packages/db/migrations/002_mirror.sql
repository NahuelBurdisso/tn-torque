-- Cast tolerante: el raw viene de una API de terceros y un valor corrupto
-- en una sola fila NO puede abortar el upsert del lote entero.
CREATE FUNCTION tnt_num(t text) RETURNS numeric
  LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS
  $$ BEGIN RETURN t::numeric; EXCEPTION WHEN others THEN RETURN NULL; END $$;

CREATE TABLE products (
  store_id      bigint NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  id            bigint NOT NULL,
  raw           jsonb  NOT NULL,
  name          text GENERATED ALWAYS AS (raw->'name'->>'es')   STORED,
  handle        text GENERATED ALWAYS AS (raw->'handle'->>'es') STORED,
  tn_updated_at timestamptz,
  deleted_at    timestamptz,
  synced_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, id)
);

CREATE TABLE variants (
  store_id      bigint NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  id            bigint NOT NULL,
  product_id    bigint NOT NULL,
  raw           jsonb  NOT NULL,
  sku           text    GENERATED ALWAYS AS (raw->>'sku')                          STORED,
  price         numeric GENERATED ALWAYS AS (tnt_num(raw->>'price'))               STORED,
  promo_price   numeric GENERATED ALWAYS AS (tnt_num(raw->>'promotional_price'))   STORED,
  -- stock es columna normal, no generada: TN manda null cuando la variante
  -- no tiene control de stock, y null != 0 para la lógica de reposición.
  stock         integer,
  tn_updated_at timestamptz,
  deleted_at    timestamptz,
  synced_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, id)
);

CREATE INDEX variants_by_product ON variants (store_id, product_id);
