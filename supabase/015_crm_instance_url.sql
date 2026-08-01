-- ---------------------------------------------------------------------------
-- 015. INSTANCE URL FOR CRM CONNECTIONS
--
-- Salesforce is not one API endpoint. Every org lives on its own host, returned with
-- the tokens as `instance_url`, and calling the wrong host fails even with a perfectly
-- valid token. HubSpot has no equivalent, which is why this was not needed until now.
--
-- Stored in the clear on purpose: it is a hostname, not a credential, and the tokens
-- beside it are already encrypted.
-- ---------------------------------------------------------------------------

alter table public.crm_connections
  add column if not exists instance_url text;
