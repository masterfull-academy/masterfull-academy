# Masterfull Academy

Plataforma educativa estática para GitHub Pages con cursos y exámenes cargados desde archivos JSON, autenticación con Supabase y resultados centralizados en PostgreSQL/Supabase.

## Arquitectura

- **GitHub Pages** publica `index.html`, `styles.css`, `app.js`, `config.js` y la carpeta `data/`.
- **JSON en `data/`** contiene el catálogo de cursos y exámenes publicados.
- **Supabase Auth** registra alumnos, inicia sesión y mantiene sesiones.
- **Supabase PostgreSQL** guarda perfiles, roles y resultados.
- **localStorage** solo conserva preferencias de sonido, borradores locales del constructor, intentos activos y cola temporal de resultados pendientes.

## Espacio docente tipo LMS

El panel del profesor está organizado como un espacio de gestión académica:

- **Inicio** resume cursos, borradores, evaluaciones e intentos registrados.
- **Cursos** permite crear, editar, publicar y eliminar espacios de aprendizaje.
- **Evaluaciones** reúne el constructor, la importación y la exportación JSON.
- **Calificaciones** centraliza intentos, filtros, revisión y exportación CSV.

La reorganización visual no elimina la portabilidad de los JSON. `data/catalog.json` y `data/exams/` continúan funcionando como catálogo estático, mientras que la publicación directa y los resultados usan Supabase cuando está configurado.

## Configurar `config.js`

1. Copia `config.example.js` como `config.js` si necesitas recrearlo.
2. En Supabase abre **Project Settings > API**.
3. Copia la **Project URL**.
4. Copia la **Publishable key** que empieza con `sb_publishable_`.
5. Edita `config.js`:

```js
window.APP_CONFIG = {
  SUPABASE_URL: "https://TU-PROYECTO.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_TU_CLAVE_PUBLICA"
};
```

No coloques `service_role`, `sb_secret`, contraseña de PostgreSQL, cadena de conexión ni tokens de GitHub en el frontend.

Si `config.js` queda con valores de ejemplo, la plataforma mostrará: “No se configuró la conexión con Supabase. Revisa config.js.”

## Configurar Supabase

1. Crea un proyecto en Supabase.
2. Abre **SQL Editor**.
3. Ejecuta completo el archivo `supabase/schema.sql`.
4. Ve a **Authentication > URL Configuration**.
5. En **Site URL** coloca tu URL final de GitHub Pages:

```text
https://TU-USUARIO.github.io/TU-REPOSITORIO/
```

6. En **Redirect URLs** agrega la misma URL.
7. Para desarrollo local agrega:

```text
http://localhost:5500/
```

8. En **Authentication > Providers > Email**, activa el registro por correo.
9. Decide si exigirás confirmación de correo. Si está activa, el alumno verá que debe revisar su correo.

## Convertir una cuenta en profesor

El registro público crea solamente alumnos. Para crear un profesor:

1. Registra la cuenta normalmente desde la plataforma.
2. En Supabase ejecuta:

```sql
update public.profiles
set role = 'teacher'
where email = 'CORREO_DEL_PROFESOR';
```

La app no permite que un alumno cambie su propio rol desde el navegador.

## Publicar en GitHub Pages

1. Crea un repositorio en GitHub.
2. Sube los archivos del proyecto.
3. Abre **Settings**.
4. Entra en **Pages**.
5. Selecciona **Deploy from a branch**.
6. Elige la rama `main`.
7. Elige la carpeta `/ (root)`.
8. Guarda.
9. Copia la URL final:

```text
https://TU-USUARIO.github.io/TU-REPOSITORIO/
```

## Desarrollo local

No abras `index.html` con doble clic. Usa un servidor HTTP:

```bash
python -m http.server 5500
```

Luego abre:

```text
http://localhost:5500/
```

## Subir cursos y exámenes JSON

Los alumnos solo ven lo publicado en `data/catalog.json` y `data/exams/`.

1. Entra como profesor.
2. Crea o edita un borrador local.
3. Usa **Validar JSON**.
4. Usa **Exportar examen JSON**.
5. Sube el archivo exportado a `data/exams/`.
6. Copia la ruta con **Copiar ruta para catalog.json**.
7. Agrega esa ruta en `data/catalog.json`, dentro del curso correspondiente.
8. Haz commit y sube los cambios.
9. Espera la actualización de GitHub Pages.
10. Recarga la plataforma.

Ejemplo de ruta:

```json
"./data/exams/fisica-mru.json"
```

## Esquema del examen JSON

```json
{
  "schema_version": 1,
  "id": "fisica-mru-01",
  "course_id": "fisica",
  "title": "Movimiento Rectilíneo Uniforme",
  "minutes": 20,
  "questions_to_show": 5,
  "attempts_allowed": 2,
  "published": true,
  "option_count": 5,
  "questions": [
    {
      "id": "mru-001",
      "text": "¿Cuál es la unidad de velocidad en el SI?",
      "image": "",
      "options": ["m", "m/s", "m/s²", "kg", "N"],
      "correct": 1
    }
  ]
}
```

`correct` usa índice desde cero. La importación también acepta formatos antiguos como `pregunta`, `opciones` y `respuesta_correcta`.

## Resultados y seguridad

Los resultados se guardan en `public.results`. Si falla Internet, la plataforma crea una cola local `aulaquiz_pending_results_v1` y reintenta al iniciar sesión o recuperar conexión.

Consulta `SECURITY.md`: las respuestas correctas están en JSON público, por lo que esta versión sirve para prácticas y evaluaciones básicas, no para exámenes antifraude.
