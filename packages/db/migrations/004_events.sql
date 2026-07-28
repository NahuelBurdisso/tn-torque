CREATE TABLE events (
  id          bigserial PRIMARY KEY,
  store_id    bigint NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  type        text   NOT NULL,
  entity_type text   NOT NULL,
  entity_id   bigint NOT NULL,
  payload     jsonb  NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  -- La garantía de "una sola vez" vive acá, en la base. No en el código.
  dedupe_key  text   NOT NULL UNIQUE
);

CREATE INDEX events_by_store_type ON events (store_id, type, id);

-- Un puntero por módulo sobre la tabla de eventos. Permite activar un módulo
-- meses después sin reprocesar el historial ni perderlo.
CREATE TABLE event_deliveries (
  event_id   bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  module     text   NOT NULL,
  status     text   NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','delivered','skipped','failed')),
  attempts   integer NOT NULL DEFAULT 0,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, module)
);

CREATE INDEX event_deliveries_pending ON event_deliveries (module, status);
