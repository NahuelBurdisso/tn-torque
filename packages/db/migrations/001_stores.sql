CREATE TABLE stores (
  id                  bigint PRIMARY KEY,
  slug                text NOT NULL UNIQUE,
  name                text NOT NULL,
  timezone            text NOT NULL,
  instance            text NOT NULL,
  state               text NOT NULL DEFAULT 'active'
                        CHECK (state IN ('active','needs_reauth','inactive')),
  access_token_sealed text,
  scope               text,
  backfilled_at       timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
