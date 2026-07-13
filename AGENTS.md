# Publicación automática

- Trabajar directamente sobre la rama predeterminada del repositorio.
- Antes de modificar, ejecutar fetch y actualizar desde origin.
- Realizar todos los cambios solicitados.
- Ejecutar las comprobaciones disponibles.
- Si las comprobaciones terminan correctamente, crear un commit descriptivo.
- Subir automáticamente el commit a origin.
- No crear ramas temporales.
- No crear Pull Requests.
- No generar archivos ZIP.
- No usar push --force.
- No almacenar secretos en el repositorio.
- La clave sb_publishable_ de Supabase puede permanecer en config.js.
- Nunca publicar sb_secret_, service_role, tokens de GitHub ni contraseñas.
- Detenerse únicamente ante conflictos, pruebas fallidas, secretos o instrucciones destructivas.
- Cuando yo diga “publica”, completar modificación, pruebas, commit y push.
