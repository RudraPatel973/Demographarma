-- Patient home address, transcribed from the visit and sent to Photon as the default order address.
-- Shape: {"street1": "...", "street2": "...", "city": "...", "state": "NY", "postalCode": "11201"}
alter table patients add column if not exists address jsonb;
