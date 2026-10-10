-- Keep the original coarse status CHECK compatible with legacy writers.
-- The conveyor's precise delivery state lives on the SAME delivery row.
ALTER TABLE pixie_deliveries ADD COLUMN delivery_state TEXT;
DROP TRIGGER IF EXISTS pixie_delivery_log_on_insert;
DROP TRIGGER IF EXISTS pixie_delivery_log_on_state_change;
CREATE TRIGGER pixie_delivery_log_on_insert AFTER INSERT ON pixie_deliveries
BEGIN
  INSERT INTO pixie_delivery_events(event_id,delivery_id,event_type,evidence_ref,created_at,old_state,reason,receipt_ref)
  VALUES(lower(hex(randomblob(16))),NEW.delivery_id,COALESCE(NEW.delivery_state,NEW.status),NEW.evidence_ref,NEW.created_at,NULL,NEW.reason,NEW.receipt_ref);
END;
CREATE TRIGGER pixie_delivery_log_on_state_change AFTER UPDATE OF status,delivery_state ON pixie_deliveries
WHEN COALESCE(OLD.delivery_state,OLD.status) <> COALESCE(NEW.delivery_state,NEW.status)
BEGIN
  INSERT INTO pixie_delivery_events(event_id,delivery_id,event_type,evidence_ref,created_at,old_state,reason,receipt_ref)
  VALUES(lower(hex(randomblob(16))),NEW.delivery_id,COALESCE(NEW.delivery_state,NEW.status),NEW.evidence_ref,NEW.updated_at,COALESCE(OLD.delivery_state,OLD.status),NEW.reason,NEW.receipt_ref);
END;
