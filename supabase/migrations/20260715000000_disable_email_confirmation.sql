-- Confirma de forma idempotente las cuentas creadas antes de desactivar
-- la confirmación de correo en Supabase Auth. No elimina ni altera perfiles.
update auth.users
set email_confirmed_at = coalesce(email_confirmed_at, now())
where email_confirmed_at is null;
