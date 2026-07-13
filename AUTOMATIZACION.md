# Automatización de publicación

## Qué quedó automatizado

El proyecto trabaja directamente sobre la rama predeterminada `main`. Cuando un cambio validado se publica en esa rama, GitHub Pages puede actualizar el sitio desde la raíz según la configuración existente del repositorio.

Los cambios de base de datos se guardan como archivos SQL con timestamp dentro de `supabase/migrations/`. Si un push a `main` modifica esa carpeta, el workflow **Publicar migraciones de Supabase** enlaza el proyecto y ejecuta `supabase db push`. También puede iniciarse manualmente desde GitHub Actions.

## Secretos que debes configurar una sola vez

En GitHub abre **Settings > Secrets and variables > Actions > New repository secret** y crea:

- `SUPABASE_ACCESS_TOKEN`: token personal generado en la configuración de tu cuenta de Supabase.
- `SUPABASE_DB_PASSWORD`: contraseña de la base de datos del proyecto.
- `SUPABASE_PROJECT_ID`: identificador o project ref visible en la URL y configuración del proyecto Supabase.

Guarda estos valores únicamente como secretos cifrados de GitHub. No los escribas en archivos del repositorio.

## Orden natural para trabajar

En adelante puedes pedir:

> Haz este cambio, pruébalo y publícalo.

Esto significa: actualizar desde `origin`, realizar el cambio, ejecutar las comprobaciones, crear un commit descriptivo y subirlo directamente a `main`.

## Cómo revisar un fallo

1. Entra al repositorio en GitHub.
2. Abre la pestaña **Actions**.
3. Selecciona **Publicar migraciones de Supabase**.
4. Abre la ejecución fallida y revisa el paso marcado en rojo.
5. Verifica primero que los tres secretos existan y que el Project ID y la contraseña correspondan al mismo proyecto.

No copies valores secretos en incidencias, commits ni capturas públicas.
