-- Expand existing PIXIE delivery tables. Do NOT create another Work/Log store.
-- Apply once after inspecting current pixie_deliveries / pixie_delivery_events schema.
ALTER TABLE pixie_deliveries ADD COLUMN actor TEXT;
ALTER TABLE pixie_deliveries ADD COLUMN work_pass_ref TEXT;
ALTER TABLE pixie_deliveries ADD COLUMN queued_at TEXT;
ALTER TABLE pixie_deliveries ADD COLUMN dispatched_at TEXT;
ALTER TABLE pixie_deliveries ADD COLUMN readback_at TEXT;
ALTER TABLE pixie_deliveries ADD COLUMN evidence_ref TEXT;
ALTER TABLE pixie_deliveries ADD COLUMN reason TEXT;
ALTER TABLE pixie_deliveries ADD COLUMN domain_completed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pixie_delivery_events ADD COLUMN old_state TEXT;
ALTER TABLE pixie_delivery_events ADD COLUMN reason TEXT;
ALTER TABLE pixie_delivery_events ADD COLUMN receipt_ref TEXT;
CREATE TRIGGER IF NOT EXISTS pixie_delivery_log_on_insert
AFTER INSERT ON pixie_deliveries
BEGIN
  INSERT INTO pixie_delivery_events(event_id,delivery_id,event_type,evidence_ref,created_at,old_state,reason,receipt_ref)
  VALUES (lower(hex(randomblob(16))),NEW.delivery_id,NEW.status,NEW.evidence_ref,NEW.created_at,NULL,NEW.reason,NEW.receipt_ref);
END;
CREATE TRIGGER IF NOT EXISTS pixie_delivery_log_on_state_change
AFTER UPDATE OF status ON pixie_deliveries
WHEN OLD.status <> NEW.status
BEGIN
  INSERT INTO pixie_delivery_events(event_id,delivery_id,event_type,evidence_ref,created_at,old_state,reason,receipt_ref)
  VALUES (lower(hex(randomblob(16))),NEW.delivery_id,NEW.status,NEW.evidence_ref,NEW.updated_at,OLD.status,NEW.reason,NEW.receipt_ref);
END;
