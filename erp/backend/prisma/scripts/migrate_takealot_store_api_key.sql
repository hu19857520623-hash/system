-- Widen Takealot API key column so AES-GCM ciphertext (enc:v1:...) can be stored.
ALTER TABLE takealot_store
  MODIFY COLUMN api_key VARCHAR(1024) NULL;
