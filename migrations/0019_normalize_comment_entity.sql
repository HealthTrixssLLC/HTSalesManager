-- Normalize comments.entity to canonical Pascal labels used by tags/activities.
-- Idempotent: rows already stored as Account/Contact/Lead/Opportunity/Activity are unchanged.

UPDATE comments SET entity = 'Account' WHERE entity IN ('accounts', 'account');
UPDATE comments SET entity = 'Contact' WHERE entity IN ('contacts', 'contact');
UPDATE comments SET entity = 'Lead' WHERE entity IN ('leads', 'lead');
UPDATE comments SET entity = 'Opportunity' WHERE entity IN ('opportunities', 'opportunity');
UPDATE comments SET entity = 'Activity' WHERE entity IN ('activities', 'activity');
