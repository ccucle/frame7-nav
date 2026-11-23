CREATE SCHEMA IF NOT EXISTS formday;
CREATE TABLE IF NOT EXISTS formday.schema_migrations (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS formday.users (
  id uuid PRIMARY KEY,
  username varchar(32) NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9._-]{4,32}$'),
  password_hash varchar(512) NOT NULL,
  recovery_hash char(64) NOT NULL,
  auth_version integer NOT NULL DEFAULT 1 CHECK (auth_version > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS formday.sessions (
  token_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES formday.users(id) ON DELETE CASCADE,
  auth_version integer NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS formday_sessions_user ON formday.sessions(user_id);
CREATE INDEX IF NOT EXISTS formday_sessions_expiry ON formday.sessions(expires_at);
CREATE TABLE IF NOT EXISTS formday.documents (
  user_id uuid PRIMARY KEY REFERENCES formday.users(id) ON DELETE CASCADE,
  version bigint NOT NULL DEFAULT 0 CHECK (version BETWEEN 0 AND 9007199254740991),
  document jsonb,
  updated_at timestamptz,
  CHECK ((version = 0 AND document IS NULL AND updated_at IS NULL) OR
         (version > 0 AND jsonb_typeof(document) = 'object' AND updated_at IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS formday.operations (
  user_id uuid NOT NULL REFERENCES formday.users(id) ON DELETE CASCADE,
  operation_id varchar(100) NOT NULL,
  expected_version bigint NOT NULL,
  request_hash char(64) NOT NULL,
  result_version bigint NOT NULL,
  result_state jsonb NOT NULL,
  result_updated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, operation_id)
);
CREATE INDEX IF NOT EXISTS formday_operations_created ON formday.operations(created_at);
CREATE TABLE IF NOT EXISTS formday.rate_buckets (
  bucket_key char(64) NOT NULL,
  bucket_start bigint NOT NULL,
  hits integer NOT NULL CHECK (hits > 0),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (bucket_key, bucket_start)
);
CREATE INDEX IF NOT EXISTS formday_rate_expiry ON formday.rate_buckets(expires_at);
INSERT INTO formday.schema_migrations(version) VALUES (1) ON CONFLICT DO NOTHING;
