-- A call delivery address belongs to one current sign-in session.
CREATE TABLE private_call_devices (
  session_hash TEXT PRIMARY KEY NOT NULL REFERENCES auth_sessions(token_hash) ON DELETE CASCADE,
  registration_token TEXT NOT NULL UNIQUE CHECK(length(registration_token) BETWEEN 1 AND 4096),
  registered_at INTEGER NOT NULL CHECK(registered_at > 0)
);

CREATE TRIGGER remove_call_devices_on_opt_out
AFTER UPDATE OF calls_enabled ON worker_agora_call_preferences
WHEN NEW.calls_enabled=0
BEGIN
  DELETE FROM private_call_devices WHERE session_hash IN (
    SELECT token_hash FROM auth_sessions WHERE account_id=NEW.account_id
  );
END;
