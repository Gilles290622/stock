ALTER TABLE `users`
  ADD CONSTRAINT `fk_users_entreprise`
  FOREIGN KEY (`entreprise_id`) REFERENCES `stock_entreprise`(`id`)
  ON DELETE SET NULL;
