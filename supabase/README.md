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

Si la base de datos ya estaba configurada antes de agregar el botón **Eliminar**, abre **SQL Editor** y ejecuta completo `supabase/enable-teacher-result-delete.sql`. La política RLS permite borrar resultados únicamente a usuarios cuyo perfil tenga el rol `teacher`.
