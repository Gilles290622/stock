-- Promote user 7 to admin if exists
UPDATE profiles SET role = 'admin' WHERE user_id = 7;