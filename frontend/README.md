# Frontend de prueba

Una app pequeña para probar heredia-front-audit: una página de login y un dashboard con
estadísticas, lista de tareas (agregar, completar, eliminar, buscar), formulario de perfil y cerrar
sesión. No tiene dependencias: `server.mjs` sirve `public/` y una API JSON simulada en memoria, que
se reinicia cada vez que reinicias el servidor.

```bash
cd frontend
npm run dev            # http://localhost:4173
```

Usuario: `demo@example.com` / `demo1234`

## Probar la herramienta

La herramienta audita cambios sin commit. Modifica algo en `frontend/public/`, no hagas commit,
arranca la app y, desde la raíz del repo, ejecuta `/heredia-front-audit`. La herramienta detecta
que la app está en `frontend/`; si no la encuentra, pásale la URL:
`/heredia-front-audit http://localhost:4173`.
