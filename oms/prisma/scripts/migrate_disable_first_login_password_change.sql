-- OMS passwords are managed by administrators.  Accounts may change their
-- password voluntarily, but a first login must not be blocked by this flag.
ALTER TABLE `oms_PortalUser`
  MODIFY COLUMN `mustChangePassword` BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE `oms_PortalUser`
SET `mustChangePassword` = FALSE
WHERE `mustChangePassword` <> FALSE;
