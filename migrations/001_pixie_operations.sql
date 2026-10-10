-- PIXIE transport state is NOT the Work lifecycle or destination execution truth.
CREATE TABLE IF NOT EXISTS pixie_attempts (
  attempt_id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL,
  checkpoint_id TEXT NOT NULL,
  station_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  work_pass_ref TEXT NOT NULL,
  actor TEXT NOT NULL,
  state TEXT NOT NULL,
  received_at TEXT NOT NULL,
  changed_at TEXT,
  queued_at TEXT,
  dispatched_at TEXT,
  readback_at TEXT,
  receipt_ref TEXT,
  evidence_ref TEXT,
  reason TEXT,
  domain_completed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pixie_attempts_work ON pixie_attempts(work_id,received_at);
CREATE INDEX IF NOT EXISTS idx_pixie_attempts_state ON pixie_attempts(state,received_at);
CREATE TABLE IF NOT EXISTS pixie_journal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id TEXT NOT NULL,
  old_state TEXT,
  new_state TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  reason TEXT,
  receipt_ref TEXT,
  evidence_ref TEXT
);
CREATE INDEX IF NOT EXISTS idx_pixie_journal_attempt ON pixie_journal(attempt_id,id);
CREATE TRIGGER IF NOT EXISTS pixie_journal_insert AFTER INSERT ON pixie_attempts
BEGIN
  INSERT INTO pixie_journal(attempt_id,old_state,new_state,observed_at,reason,receipt_ref,evidence_ref)
  VALUES (NEW.attempt_id,NULL,NEW.state,NEW.received_at,NEW.reason,NEW.receipt_ref,NEW.evidence_ref);
END;
CREATE TRIGGER IF NOT EXISTS pixie_journal_update AFTER UPDATE OF state ON pixie_attempts
WHEN OLD.state<>NEW.state
BEGIN
  INSERT INTO pixie_journal(attempt_id,old_state,new_state,observed_at,reason,receipt_ref,evidence_ref)
  VALUES (NEW.attempt_id,OLD.state,NEW.state,NEW.changed_at,NEW.reason,NEW.receipt_ref,NEW.evidence_ref);
END;
