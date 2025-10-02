-- Create indexes for password_resets (SQLite)
CREATE UNIQUE INDEX IF NOT EXISTS ux_password_resets_code ON password_resets(code);