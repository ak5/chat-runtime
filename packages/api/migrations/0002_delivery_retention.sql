ALTER TABLE event_deliveries ADD COLUMN retain_until TEXT;
CREATE INDEX event_deliveries_retention_idx ON event_deliveries(retain_until);
