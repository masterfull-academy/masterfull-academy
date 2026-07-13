# Configuración de Supabase

1. Crea un proyecto en Supabase.
2. Abre **SQL Editor**.
3. Copia y ejecuta completo `supabase/schema.sql`.
4. En **Authentication > URL Configuration**, coloca tu URL de GitHub Pages como **Site URL** y también en **Redirect URLs**.
5. Para desarrollo local agrega también `http://localhost:5500/`.
6. Activa el registro por correo en **Authentication > Providers > Email**.
7. Registra la cuenta del profesor desde la plataforma.
8. Convierte esa cuenta en profesor con:

```sql
update public.profiles
set role = 'teacher'
where email = 'CORREO_DEL_PROFESOR';
```

No uses `service_role`, contraseña de PostgreSQL ni claves secretas en el frontend. La plataforma solo necesita la Project URL y la publishable key.

## Permitir que el profesor elimine resultados

La migración `supabase/migrations/20260713000000_enable_teacher_result_delete.sql` habilita el borrado únicamente para usuarios cuyo perfil tenga el rol `teacher`. Al publicar cambios en `main`, GitHub Actions la aplica con Supabase CLI.
