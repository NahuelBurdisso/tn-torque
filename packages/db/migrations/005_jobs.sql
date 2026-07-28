CREATE TABLE batches (
  id         bigserial PRIMARY KEY,
  store_id   bigint NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  module     text NOT NULL,
  kind       text NOT NULL,
  state      text NOT NULL DEFAULT 'open'
               CHECK (state IN ('open','needs_approval','approved','halted')),
  summary    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE jobs (
  id         bigserial PRIMARY KEY,
  store_id   bigint NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  batch_id   bigint REFERENCES batches(id) ON DELETE SET NULL,
  module     text NOT NULL,
  kind       text NOT NULL,
  run_at     timestamptz NOT NULL,
  -- Una clave por trabajo: incluye módulo, entidad y paso.
  dedupe_key text NOT NULL UNIQUE,
  -- Clave amplia: lo que un solo hecho vuelve obsoleto de una.
  cancel_key text,
  state      text NOT NULL DEFAULT 'pending'
               CHECK (state IN ('needs_approval','pending','running','done','failed','cancelled')),
  attempts   integer NOT NULL DEFAULT 0,
  last_error text,
  payload    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX jobs_due ON jobs (state, run_at);
CREATE INDEX jobs_cancellable ON jobs (cancel_key)
  WHERE state IN ('pending','needs_approval');
