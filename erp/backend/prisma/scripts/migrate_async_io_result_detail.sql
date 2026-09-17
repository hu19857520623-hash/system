-- Async import row failure details (line number + reason)
ALTER TABLE `async_io_job`
  ADD COLUMN `result_detail` TEXT NULL AFTER `error_message`;
